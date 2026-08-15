import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';

import { corsOrigins, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { appointmentsRouter } from './routes/appointments.js';
import { barbersRouter } from './routes/barbers.js';
import { servicesRouter } from './routes/services.js';
import { customersRouter } from './routes/customers.js';
import { statsRouter } from './routes/stats.js';
import { webhookRouter } from './routes/webhook.js';
import { legalRouter } from './routes/legal.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export function createApp(): Express {
  const app = express();

  /**
   * ⚠️ Caddy/nginx arkasında çalışıyoruz. Bu ayar olmadan Express her isteğin
   * IP'sini proxy'nin IP'si olarak görür; rate limiter da tüm trafiği tek
   * istemci sanıp ya herkesi engeller ya da hiç kimseyi sınırlamaz.
   *
   * Değer 1 = "önümde tam olarak bir proxy var".
   */
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ── Güvenlik başlıkları ────────────────────────────────
  app.use(helmet());

  // ── CORS: yalnızca panelin adresi ──────────────────────
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true, // refresh token httpOnly cookie ile taşınıyor
    }),
  );

  // ── İstek logu + istek kimliği ─────────────────────────
  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req, res) => {
          const existing = req.headers['x-request-id'];
          const id = typeof existing === 'string' ? existing : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        // Sağlık kontrolleri her 5 dakikada geliyor; log'u kirletmesinler
        autoLogging: {
          ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
        },
      }),
    );
  }

  // ── Gövde ayrıştırma ───────────────────────────────────
  app.use(
    express.json({
      limit: '100kb',
      // Ham gövdeyi sakla — WhatsApp webhook imza doğrulaması için şart.
      // `verify` req'i http.IncomingMessage olarak tipler; Express.Request'e daraltıyoruz.
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  // ── Sağlık kontrolleri (rate limit'ten önce) ───────────
  app.use(healthRouter);

  // ── WhatsApp webhook ───────────────────────────────────
  // /api altında DEĞİL: genel IP bazlı hız sınırı buraya uygulanamaz, çünkü
  // tüm webhook trafiği Meta'nın IP'lerinden gelir ve tek istemci gibi görünür.
  app.use('/webhook', webhookRouter);

  // Gizlilik politikası — herkese açık, Meta onayı ve KVKK için gerekli.
  app.use(legalRouter);

  // ── Genel hız sınırı ───────────────────────────────────
  // Webhook'un kendi sınırı var (telefon numarasına göre); IP bazlı sınır
  // orada işe yaramaz çünkü tüm webhook trafiği Meta'nın IP'lerinden gelir.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => isTest,
      message: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.',
        },
      },
    }),
  );

  // ── API rotaları ───────────────────────────────────────
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/appointments', appointmentsRouter);
  app.use('/api/v1/barbers', barbersRouter);
  app.use('/api/v1/services', servicesRouter);
  app.use('/api/v1/customers', customersRouter);
  app.use('/api/v1/stats', statsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
