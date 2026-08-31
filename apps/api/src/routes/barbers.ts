import { Router } from 'express';
import { workingHoursSchema, createTimeOffSchema, createBarberSchema } from '@berber/shared';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getWorkingHours,
  updateWorkingHours,
  listTimeOff,
  createTimeOff,
  deleteTimeOff,
  createBarber,
} from '../services/barbers.js';
import { publicShopInfoOnbelleginiDusur } from '../services/public-booking.js';

export const barbersRouter: Router = Router();

barbersRouter.use(requireAuth);

/**
 * Berber listesi.
 *
 * staff dahil herkese açık: panelin takvim ekranı berber seçici için buna
 * ihtiyaç duyuyor (örn. admin başka berberin takvimine bakarken).
 * Randevu VERİSİ ayrı bir yetki katmanına tabi (bkz. appointments.ts) —
 * burada yalnızca ad/aktiflik döner, hassas veri yok.
 */
barbersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const barbers = await prisma.barber.findMany({
      where: { shopId: req.auth!.shopId, isActive: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });

    res.json({ barbers });
  }),
);

/** Yeni berber ekler — yalnızca admin. */
barbersRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = createBarberSchema.parse(req.body);
    const result = await createBarber(req.auth!.shopId, input.name, input.email, input.role);

    // Yeni berber sitedeki berber listesine girmeli (bkz. public-booking.ts).
    publicShopInfoOnbelleginiDusur();
    res.status(201).json(result);
  }),
);

/** Bir berberin haftalık çalışma programı. staff yalnızca kendisininkini görebilir. */
barbersRouter.get(
  '/:id/working-hours',
  asyncHandler(async (req, res) => {
    const workingHours = await getWorkingHours(req.auth!.shopId, req.params.id!, req.auth!);
    res.json({ workingHours });
  }),
);

/** Haftalık programı günceller (7 gün birden). */
barbersRouter.put(
  '/:id/working-hours',
  asyncHandler(async (req, res) => {
    const days = workingHoursSchema.parse(req.body);
    const workingHours = await updateWorkingHours(req.auth!.shopId, req.params.id!, days, req.auth!);

    // Site, kapalı günleri haftalık düzenden okuyor ve bu yanıt önbellekli;
    // berber bir günü kapattığında tarih şeridi hemen güncellensin diye
    // önbellek düşürülüyor (bkz. services/public-booking.ts).
    publicShopInfoOnbelleginiDusur();
    res.json({ workingHours });
  }),
);

/** Bir berberin gelecekteki izin günleri. */
barbersRouter.get(
  '/:id/time-off',
  asyncHandler(async (req, res) => {
    const timeOff = await listTimeOff(req.auth!.shopId, req.params.id!, req.auth!);
    res.json({ timeOff });
  }),
);

/** İzin/kapalı gün ekler. */
barbersRouter.post(
  '/:id/time-off',
  asyncHandler(async (req, res) => {
    const input = createTimeOffSchema.parse({ ...req.body, barberId: req.params.id });
    const created = await createTimeOff(
      req.auth!.shopId,
      req.params.id!,
      new Date(input.startsAt),
      new Date(input.endsAt),
      input.reason,
      req.auth!,
    );
    res.status(201).json({ timeOff: created });
  }),
);

/** İzin kaydını siler. */
barbersRouter.delete(
  '/time-off/:timeOffId',
  asyncHandler(async (req, res) => {
    await deleteTimeOff(req.auth!.shopId, req.params.timeOffId!, req.auth!);
    res.status(204).end();
  }),
);
