import { Router } from 'express';
import { maskPhone } from '@berber/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/error-handler.js';
import {
  verifyWebhookSignature,
  verifyWebhookChallenge,
} from '../services/whatsapp/signature.js';
import { parseWebhook, type InboundMessage } from '../services/whatsapp/payload.js';
import { handleInboundMessage } from '../services/chatbot/handler.js';

export const webhookRouter: Router = Router();

/**
 * ══════════════════════════════════════════════════════════════════
 *  META DOĞRULAMA HANDSHAKE'İ (GET)
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ Bu uç olmadan webhook Meta panelinde HİÇ kaydedilemez.
 *
 * Meta, webhook URL'i girildiğinde önce buraya GET atar ve `hub.challenge`
 * değerinin DÜZ METİN olarak geri dönmesini bekler. JSON dönerse kurulum
 * başarısız olur.
 */
webhookRouter.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  if (!env.WHATSAPP_VERIFY_TOKEN) {
    logger.error('WHATSAPP_VERIFY_TOKEN tanımlı değil — doğrulama yapılamıyor');
    res.sendStatus(500);
    return;
  }

  if (verifyWebhookChallenge(mode, token, env.WHATSAPP_VERIFY_TOKEN)) {
    logger.info('Meta webhook doğrulaması başarılı');
    // Content-Type düz metin olmalı
    res.status(200).type('text/plain').send(challenge ?? '');
    return;
  }

  logger.warn('Meta webhook doğrulaması başarısız — jeton eşleşmedi');
  res.sendStatus(403);
});

/**
 * ══════════════════════════════════════════════════════════════════
 *  GELEN MESAJLAR (POST)
 * ══════════════════════════════════════════════════════════════════
 *
 * İki savunma katmanı:
 *
 *   1. İMZA — bu isteği gerçekten Meta mi gönderdi? Doğrulanmazsa adresi
 *      bulan herkes sahte müşteri mesajı üretebilir.
 *
 *   2. IDEMPOTENCY — Meta yanıt alamadığında aynı webhook'u tekrar gönderir.
 *      wamid üzerindeki UNIQUE kısıt olmadan aynı "ONAYLA" iki kez işlenir
 *      ve çift randevu oluşur.
 *
 * Yanıt her zaman hızlı 200 olmalı: Meta 20 saniyede yanıt alamazsa isteği
 * başarısız sayıp tekrar gönderir. İşleme hatası olsa bile 200 dönüyoruz,
 * çünkü tekrar denemek aynı hatayı üretecektir.
 */
webhookRouter.post(
  '/whatsapp',
  asyncHandler(async (req, res) => {
    // ── 1. İmza ────────────────────────────────────────
    if (!env.WHATSAPP_APP_SECRET) {
      // Yapılandırma eksikse webhook'u AÇIK BIRAKMIYORUZ.
      logger.error('WHATSAPP_APP_SECRET tanımlı değil — webhook reddedildi');
      res.sendStatus(403);
      return;
    }

    const verification = verifyWebhookSignature(
      req.rawBody,
      req.headers['x-hub-signature-256'] as string | undefined,
      env.WHATSAPP_APP_SECRET,
    );

    if (!verification.valid) {
      logger.warn({ reason: verification.reason }, 'Webhook imzası geçersiz — istek reddedildi');
      res.sendStatus(403);
      return;
    }

    // ── 2. Ayrıştır ────────────────────────────────────
    const { messages, statuses } = parseWebhook(req.body);

    // Meta'yı bekletmemek için hemen yanıt veriyoruz; işleme arka planda sürüyor.
    res.sendStatus(200);

    // ── 3. Durum bildirimleri ──────────────────────────
    for (const status of statuses) {
      await prisma.outboundMessage
        .updateMany({
          where: { wamid: status.wamid },
          data: {
            status: status.status,
            errorCode: status.errorCode,
            errorText: status.errorText,
          },
        })
        .catch((error: unknown) => {
          logger.error({ err: error, wamid: status.wamid }, 'Durum güncellenemedi');
        });
    }

    // ── 4. Gelen mesajlar ──────────────────────────────
    for (const message of messages) {
      await processMessage(message).catch((error: unknown) => {
        logger.error(
          { err: error, from: maskPhone(message.from) },
          'Gelen mesaj işlenemedi',
        );
      });
    }
  }),
);

/**
 * Tek bir gelen mesajı işler.
 *
 * Idempotency burada: `webhook_events.wamid` UNIQUE olduğu için aynı mesaj
 * ikinci kez geldiğinde insert başarısız olur ve işleme atlanır.
 */
async function processMessage(message: InboundMessage): Promise<void> {
  try {
    await prisma.webhookEvent.create({
      data: {
        wamid: message.wamid,
        payload: {
          from: message.from,
          text: message.text,
          isInteractive: message.isInteractive,
          unsupportedType: message.unsupportedType,
        },
      },
    });
  } catch {
    // UNIQUE ihlali = bu mesajı daha önce aldık. Sessizce atla.
    logger.debug({ wamid: message.wamid }, 'Tekrarlanan webhook atlandı');
    return;
  }

  try {
    await handleInboundMessage(message);

    await prisma.webhookEvent.update({
      where: { wamid: message.wamid },
      data: { processedAt: new Date() },
    });
  } catch (error) {
    await prisma.webhookEvent
      .update({
        where: { wamid: message.wamid },
        data: { error: error instanceof Error ? error.message : String(error) },
      })
      .catch(() => {
        /* kayıt güncellenemezse asıl hatayı gölgelemesin */
      });

    throw error;
  }
}
