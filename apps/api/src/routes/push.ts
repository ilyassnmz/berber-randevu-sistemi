import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getPublicKey, isPushConfigured } from '../services/push.js';

/**
 * Bildirim abonelikleri.
 *
 * Berber panelden "bildirimleri aç" dediğinde tarayıcı bir abonelik üretiyor
 * (endpoint + iki anahtar); burada saklanıyor ki sunucu ona bildirim
 * gönderebilsin.
 */
export const pushRouter: Router = Router();

pushRouter.use(requireAuth);

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

/** Panelin aboneliği kurabilmesi için gereken açık anahtar. */
pushRouter.get(
  '/key',
  asyncHandler(async (_req, res) => {
    res.json({ publicKey: getPublicKey(), enabled: isPushConfigured });
  }),
);

/**
 * Aboneliği kaydeder.
 *
 * `endpoint` benzersiz: aynı cihaz tekrar abone olduğunda yeni kayıt
 * açılmaz, mevcut kayıt o berbere bağlanır. Bu olmadan berber bildirimleri
 * kapatıp açtıkça kayıtlar birikir ve her randevuda aynı cihaza defalarca
 * bildirim giderdi.
 */
pushRouter.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const input = subscriptionSchema.parse(req.body);
    const barberId = req.auth!.barberId;

    await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        barberId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: req.get('user-agent')?.slice(0, 250) ?? null,
      },
      update: {
        barberId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    });

    res.status(201).json({ ok: true });
  }),
);

/** Aboneliği kaldırır — berber bildirimleri kapattığında. */
pushRouter.post(
  '/unsubscribe',
  asyncHandler(async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);

    // Yalnızca KENDİ aboneliğini silebilir; başkasınınkini değil.
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, barberId: req.auth!.barberId },
    });

    res.json({ ok: true });
  }),
);

/** Berberin bu cihazda abone olup olmadığını söyler. */
pushRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const sayi = await prisma.pushSubscription.count({
      where: { barberId: req.auth!.barberId },
    });
    res.json({ subscriptions: sayi, enabled: isPushConfigured });
  }),
);
