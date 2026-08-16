import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { slotsQuerySchema, publicBookingSchema } from '@berber/shared';
import { isTest } from '../config/env.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { getAvailableSlots } from '../services/appointments.js';
import {
  getPublicShop,
  getPublicShopInfo,
  createPublicAppointment,
  getAppointmentByToken,
  cancelAppointmentByToken,
} from '../services/public-booking.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  HERKESE AÇIK UÇLAR — internet sitesi
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ Bu router'da `requireAuth` YOK ve olmamalı — müşteriler giriş yapmadan
 * randevu alıyor. Bunun iki sonucu var ve ikisi de gözden kaçırılmamalı:
 *
 *   1. Buraya eklenen HER uç, internetteki herkese açıktır. Yeni bir uç
 *      eklerken "bu bilgiyi tanımadığım biri görebilir mi?" sorusu
 *      cevaplanmadan eklenmemeli.
 *   2. Hız sınırı ayrı ve daha sıkı (bkz. app.ts). Panel uçlarının sınırı
 *      giriş yapmış birkaç berber için ayarlı; burası açık internet.
 *
 * Yanıtların içeriği bilerek dar: berberlerin e-postası, müşterilerin
 * telefonu, gelmedi sayaçları gibi alanlar bu uçlardan asla dönmez.
 */
export const publicRouter: Router = Router();

/**
 * Randevu bağlantısındaki gizli anahtar.
 *
 * Biçim doğrulaması, veritabanına anlamsız sorgu gitmesini engelliyor
 * (base64url, 24 bayt → 32 karakter). Aralık biraz geniş tutuldu ki anahtar
 * uzunluğu ileride değişirse bu regex sessiz bir arızaya dönüşmesin.
 */
const tokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,64}$/, 'Geçersiz randevu bağlantısı');

/** Dükkan bilgisi + hizmetler + berberler. Site açılışta bunu çeker. */
publicRouter.get(
  '/shop',
  asyncHandler(async (_req, res) => {
    res.json(await getPublicShopInfo());
  }),
);

/**
 * Seçilen berber/hizmet/gün için uygun saatler.
 *
 * `getAvailableSlots`'a auth GEÇİLMİYOR — bu bilinçli. Auth'un yokluğu, slot
 * motoruna "çağıran müşteri" demektir ve 7 günlük ileri tarih sınırını devreye
 * sokar (bkz. services/appointments.ts → BookingActor). Buraya auth eklemek
 * sınırı sessizce kaldırırdı.
 */
publicRouter.get(
  '/slots',
  asyncHandler(async (req, res) => {
    const { barberId, serviceId, date } = slotsQuerySchema.parse(req.query);
    const shop = await getPublicShop();

    const slots = await getAvailableSlots(shop.id, barberId, serviceId, date);

    res.json({
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        label: s.label,
      })),
    });
  }),
);

/**
 * Randevu oluşturmaya özel, okuma uçlarından çok daha dar hız sınırı.
 *
 * ── Neden sadece bu uç? ───────────────────────────────────────────
 * Saat listelemek zararsız ve sık yapılıyor (müşteri günler arasında gezinir);
 * randevu YAZMAK ise takvimi kirletebilecek tek işlem.
 *
 * ── Neden 10/saat, daha az değil? ─────────────────────────────────
 * Türkiye'de mobil operatörler çok sayıda aboneyi aynı genel IP'nin arkasına
 * koyuyor (CGNAT). Sınır 2-3 olsaydı, aynı operatörden bağlanan farklı gerçek
 * müşteriler birbirini engellerdi. 10, kötüye kullanımı anlamlı biçimde
 * yavaşlatırken normal kullanımı serbest bırakıyor.
 *
 * ⚠️ Tek başına yeterli DEĞİL, savunmanın bir katmanı. Diğerleri:
 * "aynı güne ikinci randevu alınamaz" kuralı (bir telefon, gün başına en fazla
 * bir randevu), 7 günlük tarih penceresi ve berberin kara liste yetkisi.
 */
const bookingLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Çok fazla randevu denemesi yaptınız. Lütfen bir süre sonra tekrar deneyin.',
    },
  },
});

/** Randevu oluşturur. Yanıtta dönen `token` iptal bağlantısında kullanılır. */
publicRouter.post(
  '/appointments',
  bookingLimiter,
  asyncHandler(async (req, res) => {
    const input = publicBookingSchema.parse(req.body);

    const { appointment, publicToken } = await createPublicAppointment({
      barberId: input.barberId,
      serviceId: input.serviceId,
      startsAt: new Date(input.startsAt),
      customerName: input.customerName,
      customerPhone: input.customerPhone,
    });

    res.status(201).json({
      token: publicToken,
      appointment: {
        startsAt: appointment.startsAt.toISOString(),
        status: appointment.status,
        barberName: appointment.barber.name,
        serviceName: appointment.service.name,
        servicePrice: appointment.service.price,
        customerName: appointment.customer.name,
      },
    });
  }),
);

/** Randevu detayı — yalnızca gizli anahtarla. */
publicRouter.get(
  '/appointments/:token',
  asyncHandler(async (req, res) => {
    const token = tokenSchema.parse(req.params.token);
    const appointment = await getAppointmentByToken(token);

    res.json({
      appointment: {
        ...appointment,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
      },
    });
  }),
);

/** Randevu iptali — yalnızca gizli anahtarla. */
publicRouter.post(
  '/appointments/:token/cancel',
  asyncHandler(async (req, res) => {
    const token = tokenSchema.parse(req.params.token);
    await cancelAppointmentByToken(token);

    res.json({ ok: true });
  }),
);
