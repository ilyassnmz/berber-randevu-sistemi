import { Router } from 'express';
import { statsQuerySchema } from '@berber/shared';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getStats } from '../services/stats.js';

export const statsRouter: Router = Router();

statsRouter.use(requireAuth);

/**
 * Dönemsel özet istatistikler.
 *
 * staff'a da açık ama servis katmanı veriyi kendi randevularıyla
 * sınırlıyor — yetki kararı orada, burada değil (bkz. services/stats.ts).
 */
statsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = statsQuerySchema.parse(req.query);
    const stats = await getStats(
      {
        shopId: req.auth!.shopId,
        from: query.from,
        to: query.to,
        barberId: query.barberId,
      },
      req.auth!,
    );
    res.json(stats);
  }),
);
