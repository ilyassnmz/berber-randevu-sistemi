import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';
import { setWhatsAppClient, type WhatsAppClient, type SendResult } from '../src/services/whatsapp/client.js';
import { sendToCustomer } from '../src/services/whatsapp/messaging.js';

/**
 * Meta hata kodu davranışları.
 *
 * `FakeWhatsAppClient` her zaman başarılı döndüğü için burada kendi sahte
 * istemcimizi yazıyoruz: gerçek Meta'nın 131047 (yeniden etkileşim gerekli)
 * hatasını simüle edip `sendToCustomer`'ın gerçekten şablona düştüğünü
 * kanıtlıyoruz.
 */

class ReengagementRequiredClient implements WhatsAppClient {
  sentTemplates: Array<{ to: string; templateName: string; params: string[] }> = [];

  private fail(): SendResult {
    return { success: false, wamid: null, errorCode: '131047', errorText: 'Re-engagement message' };
  }

  sendText(): Promise<SendResult> {
    return Promise.resolve(this.fail());
  }
  sendButtons(): Promise<SendResult> {
    return Promise.resolve(this.fail());
  }
  sendList(): Promise<SendResult> {
    return Promise.resolve(this.fail());
  }
  sendTemplate(to: string, templateName: string, params: string[]): Promise<SendResult> {
    this.sentTemplates.push({ to, templateName, params });
    return Promise.resolve({ success: true, wamid: 'fake_template_wamid' });
  }
}

let fx: TestFixture;
const client = new ReengagementRequiredClient();

beforeAll(async () => {
  setWhatsAppClient(client);
  fx = await createFixture();
});

afterAll(async () => {
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
  setWhatsAppClient(null);
});

beforeEach(() => {
  client.sentTemplates = [];
});

describe('131047 (yeniden etkileşim gerekli) → şablona düşme', () => {
  it('pencere bizim tarafımızda açık görünse de Meta 131047 dönerse şablona düşülür', async () => {
    // Pencere açık gibi görünüyor (az önce mesaj attı) ama sahte istemci
    // yine de 131047 döndürüyor — tam olarak simüle etmek istediğimiz yarış durumu.
    await testPrisma.customer.update({
      where: { id: fx.customerId },
      data: { lastInboundAt: new Date() },
    });

    const outcome = await sendToCustomer(fx.customerId, {
      text: 'Serbest metin denemesi',
      template: 'APPOINTMENT_CONFIRMED',
      templateParams: ['tarih', 'saat', 'berber', 'hizmet'],
    });

    expect(outcome.sent).toBe(true);
    expect(client.sentTemplates).toHaveLength(1);
    expect(client.sentTemplates[0]!.templateName).toBe('randevu_onay');

    const outbound = await testPrisma.outboundMessage.findFirst({
      where: { customerId: fx.customerId },
      orderBy: { createdAt: 'desc' },
    });
    expect(outbound?.status).toBe('sent');
    expect(outbound?.templateName).toBe('randevu_onay');
  });
});
