import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';

/**
 * Webhook — imza doğrulaması ve GERÇEK arka plan işleme.
 *
 * `res.sendStatus(200)` erken dönüyor; asıl işleme `trackBackgroundWork`
 * ile izleniyor. `waitForPendingWebhookWork()` çağrısı bu işin bittiğini
 * garanti etmeli — graceful shutdown'ın (index.ts) dayandığı sözleşme bu.
 */

const APP_SECRET = 'test-webhook-app-secret';

let app: Express;
let waitForPendingWebhookWork: () => Promise<void>;
let setWhatsAppClient: (client: unknown) => void;
let fx: TestFixture;

function sign(rawBody: string): string {
  const digest = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}

beforeAll(async () => {
  // env.ts modül yüklenirken process.env'i okuyor — bu yüzden env.ts'e
  // (doğrudan ya da dolaylı) dokunan HER import burada, env değişkenleri
  // ayarlandıktan SONRA dinamik olarak yapılıyor. Statik bir import (dosyanın
  // en altına yazılsa bile) hoisting nedeniyle bundan önce çalışıp env.ts'i
  // eski (boş) process.env ile modül önbelleğine kilitlerdi.
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';

  const appModule = await import('../src/app.js');
  const webhookModule = await import('../src/routes/webhook.js');
  const clientModule = await import('../src/services/whatsapp/client.js');
  app = appModule.createApp();
  waitForPendingWebhookWork = webhookModule.waitForPendingWebhookWork;
  setWhatsAppClient = clientModule.setWhatsAppClient;

  setWhatsAppClient(new clientModule.FakeWhatsAppClient());
  fx = await createFixture();

  await testPrisma.shop.update({
    where: { id: fx.shopId },
    data: { whatsappPhoneId: 'webhook-test-phone-id' },
  });
});

afterAll(async () => {
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
  setWhatsAppClient(null);
});

describe('POST /webhook/whatsapp', () => {
  it('geçersiz imzayı reddeder', async () => {
    const payload = JSON.stringify({ entry: [] });
    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=yanlis')
      .send(payload);

    expect(res.status).toBe(403);
  });

  it('geçerli imzalı mesajı hemen 200 döner VE arka planda gerçekten işler', async () => {
    const wamid = `wamid.webhook-test.${Date.now()}`;
    const from = '+905559990001';

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'webhook-test-phone-id' },
                contacts: [{ profile: { name: 'Webhook Testi' } }],
                messages: [
                  {
                    id: wamid,
                    from: from.replace('+', ''),
                    type: 'text',
                    text: { body: 'merhaba' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(rawBody))
      .send(rawBody);

    expect(res.status).toBe(200);

    // Yanıt döndü ama işleme muhtemelen henüz bitmemiştir — asıl kanıt bu:
    // shutdown'ın da yaptığı gibi bekleyip SONRA kontrol ediyoruz.
    await waitForPendingWebhookWork();

    const event = await testPrisma.webhookEvent.findUnique({ where: { wamid } });
    expect(event?.processedAt).not.toBeNull();

    const session = await testPrisma.chatSession.findUnique({ where: { phone: from } });
    expect(session).not.toBeNull();
  });
});
