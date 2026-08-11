import pino from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

/**
 * Yapısal loglama.
 *
 * ⚠️ KVKK: Ham telefon numarası log'a YAZILMAZ. Numara loglanacaksa
 * `maskPhone()` ile maskelenir (bkz. @berber/shared → phone.ts).
 * Aşağıdaki `redact` listesi, yanlışlıkla loglanan hassas alanları da yakalar.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,

  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-hub-signature-256"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.tokenHash',
      // Ham telefon alanları — maskeleme atlanırsa son savunma hattı
      '*.phone',
      '*.customerPhone',
      '*.contactPhone',
    ],
    censor: '[gizlendi]',
  },

  // Geliştirmede okunabilir renkli çıktı, üretimde JSON (log toplayıcılar için)
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
});

export type Logger = typeof logger;
