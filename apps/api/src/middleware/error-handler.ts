import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, SlotTakenError, isOverlapViolation } from '../lib/errors.js';
import { isProduction } from '../config/env.js';
import { logger } from '../lib/logger.js';

/** Tanımsız rotalar için 404. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Bulunamadı: ${req.method} ${req.path}`,
    },
  });
};

/**
 * Merkezi hata yakalayıcı.
 *
 * ⚠️ İç hata detayı istemciye SIZDIRILMAZ. Beklenmeyen hatalarda kullanıcıya
 * genel bir mesaj döner; ayrıntı sadece log'a ve Sentry'ye gider. Aksi halde
 * yığın izi veya SQL metni saldırgana bilgi verir.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // ── Slot çakışması ────────────────────────────────────
  // Veritabanındaki appointments_no_overlap kısıtı devreye girdi.
  // Bu bir hata değil, beklenen bir yarış durumu sonucu.
  if (isOverlapViolation(err)) {
    const slotError = new SlotTakenError();
    logger.info({ path: req.path }, 'Slot çakışması yakalandı');
    res.status(slotError.statusCode).json({
      error: { code: slotError.code, message: slotError.message },
    });
    return;
  }

  // ── Doğrulama hataları ────────────────────────────────
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Gönderilen veri geçersiz',
        details: err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return;
  }

  // ── Bilinen uygulama hataları ─────────────────────────
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // ── Beklenmeyen hatalar ───────────────────────────────
  logger.error({ err, path: req.path, method: req.method }, 'Beklenmeyen hata');

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
      // Yığın izi yalnızca geliştirmede
      ...(isProduction ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
};

/**
 * Async route handler'ları sarmalar.
 * Bu olmadan async fonksiyondaki hata Express'e ulaşmaz ve istek asılı kalır.
 */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
