import { Router } from 'express';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';

export const servicesRouter: Router = Router();

servicesRouter.use(requireAuth);

/** Hizmet listesi — walk-in randevu formunda kullanılıyor. */
servicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      where: { shopId: req.auth!.shopId, isActive: true },
      select: { id: true, name: true, durationMin: true, price: true },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ services });
  }),
);
