import { Router } from 'express';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';

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
