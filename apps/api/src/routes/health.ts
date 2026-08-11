import { Router } from 'express';
import { checkDatabaseConnection } from '../db/client.js';
import { asyncHandler } from '../middleware/error-handler.js';

export const healthRouter: Router = Router();

/**
 * Canlılık kontrolü — süreç ayakta mı?
 *
 * Veritabanına BAKMAZ. Bakarsa, veritabanı kısa süre düştüğünde orkestratör
 * sağlıklı uygulamayı gereksiz yere yeniden başlatır.
 * UptimeRobot bu adresi izler.
 */
healthRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

/**
 * Hazırlık kontrolü — istek karşılayabilir durumda mı?
 * Veritabanı bağlantısını gerçekten dener.
 */
healthRouter.get(
  '/readyz',
  asyncHandler(async (_req, res) => {
    const dbOk = await checkDatabaseConnection();

    if (!dbOk) {
      res.status(503).json({
        status: 'unavailable',
        checks: { database: 'fail' },
      });
      return;
    }

    res.json({ status: 'ok', checks: { database: 'ok' } });
  }),
);
