import { Router } from 'express';
import {
  slotsQuerySchema,
  createAppointmentSchema,
  cancelAppointmentSchema,
  rescheduleAppointmentSchema,
  listAppointmentsQuerySchema,
  APPOINTMENT_SOURCE,
} from '@berber/shared';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth, assertCanAccessBarber, resolveBarberFilter } from '../middleware/auth.js';
import {
  getAvailableSlots,
  createAppointment,
  cancelAppointment,
  completeAppointment,
  markNoShow,
  rescheduleAppointment,
  listAppointments,
  getAppointment,
  findSiblingAppointments,
  cancelSiblingAppointments,
} from '../services/appointments.js';
import { ValidationError } from '../lib/errors.js';
import { getIdempotentResponse, saveIdempotentResponse } from '../services/idempotency.js';

export const appointmentsRouter: Router = Router();

// Tüm randevu uçları giriş ister
appointmentsRouter.use(requireAuth);

/**
 * Boş saatler.
 * Panel hem walk-in eklerken hem saat değiştirirken burayı kullanır.
 */
appointmentsRouter.get(
  '/slots',
  asyncHandler(async (req, res) => {
    const { barberId, serviceId, date } = slotsQuerySchema.parse(req.query);
    const auth = req.auth!;

    // Fırat başka berberin takvimini sorgulayamaz
    assertCanAccessBarber(auth, barberId);

    // `includePast: true` — berberin GÜN GÖRÜNÜMÜ için.
    //
    // Berber saat 18:45'te dükkandayken sabah 09:00'da kimin geldiğini
    // görebilmeli. Geçmiş saatler elenince o saatlerdeki randevular da
    // ekrandan kayboluyor ve "randevular silindi" izlenimi doğuyordu.
    //
    // Geçmiş saatlere randevu YAZILAMAZ; sunucu doğrulaması ayrı ve
    // `isSlotBookable` bu seçeneği zorla kapatıyor.
    const slots = await getAvailableSlots(
      auth.shopId,
      barberId,
      serviceId,
      date,
      new Date(),
      auth,
      true,
    );

    res.json({
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        label: s.label,
        isPast: s.isPast,
      })),
    });
  }),
);

/** Randevu listesi. */
appointmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listAppointmentsQuerySchema.parse(req.query);
    const auth = req.auth!;

    // staff rolü ne isterse istesin kendi kimliğine sabitlenir
    const barberId = resolveBarberFilter(auth, query.barberId);

    const result = await listAppointments({
      shopId: auth.shopId,
      barberId,
      date: query.date,
      from: query.from,
      to: query.to,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });

    res.json(result);
  }),
);

/** Tek randevu detayı. */
appointmentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const appointment = await getAppointment(auth.shopId, req.params.id!, auth);

    assertCanAccessBarber(auth, appointment.barberId);

    res.json({ appointment });
  }),
);

/**
 * Walk-in / manuel randevu.
 *
 * Kapıdan gelen müşteri sisteme girilemezse takvim gerçekle uyuşmaz;
 * berberin en sık kullanacağı uç bu.
 */
appointmentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;

    // ── Idempotency-Key ───────────────────────────────
    // Ağ hatası sonrası "gönder"e tekrar basılırsa aynı walk-in randevu
    // iki kez oluşmasın. Anahtar dükkan bazında benzersiz tutuluyor.
    const idempotencyKey = req.header('Idempotency-Key');
    if (idempotencyKey) {
      const cached = await getIdempotentResponse(auth.shopId, idempotencyKey);
      if (cached) {
        res.status(cached.statusCode).json(cached.body);
        return;
      }
    }

    const input = createAppointmentSchema.parse(req.body);

    assertCanAccessBarber(auth, input.barberId);

    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new ValidationError('Geçersiz tarih/saat');
    }

    const appointment = await createAppointment({
      shopId: auth.shopId,
      barberId: input.barberId,
      serviceId: input.serviceId,
      startsAt,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      source: APPOINTMENT_SOURCE.PANEL,
      actorId: auth.barberId,
      auth,
      notifyCustomer: input.notifyCustomer,
    });

    const body = { appointment };

    if (idempotencyKey) {
      await saveIdempotentResponse(auth.shopId, idempotencyKey, 201, body);
    }

    res.status(201).json(body);
  }),
);

/**
 * İptal.
 *
 * DELETE değil POST: randevu silinmez, durumu değişir. Geçmiş, gelmedi
 * sayacı ve denetim kaydı için kayıt korunmalı.
 */
appointmentsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { reason, notifyCustomer } = cancelAppointmentSchema.parse(req.body ?? {});
    const auth = req.auth!;

    const existing = await getAppointment(auth.shopId, req.params.id!, auth);
    assertCanAccessBarber(auth, existing.barberId);

    const appointment = await cancelAppointment(
      auth.shopId,
      req.params.id!,
      'barber',
      reason,
      auth.barberId,
      notifyCustomer,
      auth,
    );

    res.json({ appointment });
  }),
);

appointmentsRouter.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;

    const existing = await getAppointment(auth.shopId, req.params.id!, auth);
    assertCanAccessBarber(auth, existing.barberId);

    const appointment = await completeAppointment(
      auth.shopId,
      req.params.id!,
      auth.barberId,
      auth,
    );
    res.json({ appointment });
  }),
);

appointmentsRouter.post(
  '/:id/no-show',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;

    const existing = await getAppointment(auth.shopId, req.params.id!, auth);
    assertCanAccessBarber(auth, existing.barberId);

    const appointment = await markNoShow(auth.shopId, req.params.id!, auth.barberId, auth);
    res.json({ appointment });
  }),
);

appointmentsRouter.post(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const input = rescheduleAppointmentSchema.parse(req.body);
    const auth = req.auth!;

    const existing = await getAppointment(auth.shopId, req.params.id!, auth);
    assertCanAccessBarber(auth, existing.barberId);

    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new ValidationError('Geçersiz tarih/saat');
    }

    const appointment = await rescheduleAppointment(
      auth.shopId,
      req.params.id!,
      startsAt,
      auth.barberId,
      input.notifyCustomer,
      auth,
    );

    res.json({ appointment });
  }),
);

/**
 * Aynı cihazdan gelen diğer gelecek randevular.
 *
 * Panel, randevu detayında "bu cihazdan N randevu daha var" uyarısını
 * buradan alıyor. Sahte numaralarla takvim doldurma girişimini görünür
 * kılmanın tek yolu bu — numaralar ve isimler farklı, ortak nokta cihaz.
 */
appointmentsRouter.get(
  '/:id/siblings',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const items = await findSiblingAppointments(auth.shopId, req.params.id!, auth);

    res.json({
      items: items.map((a) => ({
        id: a.id,
        startsAt: a.startsAt.toISOString(),
        customerName: a.customer.name,
        barberName: a.barber.name,
        serviceName: a.service.name,
      })),
    });
  }),
);

/** Aynı cihazdan gelen gelecek randevuların tamamını iptal eder. */
appointmentsRouter.post(
  '/:id/cancel-siblings',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const result = await cancelSiblingAppointments(
      auth.shopId,
      req.params.id!,
      auth.barberId,
      auth,
    );

    res.json(result);
  }),
);
