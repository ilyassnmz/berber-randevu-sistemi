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
} from '../services/appointments.js';
import { ValidationError } from '../lib/errors.js';

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

    const slots = await getAvailableSlots(auth.shopId, barberId, serviceId, date);

    res.json({
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        label: s.label,
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
    const appointment = await getAppointment(auth.shopId, req.params.id!);

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
    const input = createAppointmentSchema.parse(req.body);
    const auth = req.auth!;

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
    });

    res.status(201).json({ appointment });
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
    const { reason } = cancelAppointmentSchema.parse(req.body ?? {});
    const auth = req.auth!;

    const existing = await getAppointment(auth.shopId, req.params.id!);
    assertCanAccessBarber(auth, existing.barberId);

    const appointment = await cancelAppointment(
      auth.shopId,
      req.params.id!,
      'barber',
      reason,
      auth.barberId,
    );

    res.json({ appointment });
  }),
);

appointmentsRouter.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;

    const existing = await getAppointment(auth.shopId, req.params.id!);
    assertCanAccessBarber(auth, existing.barberId);

    const appointment = await completeAppointment(auth.shopId, req.params.id!, auth.barberId);
    res.json({ appointment });
  }),
);

appointmentsRouter.post(
  '/:id/no-show',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;

    const existing = await getAppointment(auth.shopId, req.params.id!);
    assertCanAccessBarber(auth, existing.barberId);

    const appointment = await markNoShow(auth.shopId, req.params.id!, auth.barberId);
    res.json({ appointment });
  }),
);

appointmentsRouter.post(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const input = rescheduleAppointmentSchema.parse(req.body);
    const auth = req.auth!;

    const existing = await getAppointment(auth.shopId, req.params.id!);
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
    );

    res.json({ appointment });
  }),
);
