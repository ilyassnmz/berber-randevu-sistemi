import * as Sentry from '@sentry/node';
import { env, isProduction, isTest } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Hata izleme (Sentry).
 *
 * WhatsApp istemcisiyle aynı desen: `SENTRY_DSN` boşsa sessizce DEVRE DIŞI
 * kalır. Böylece geliştirmede ve DSN girilmeden önce üretimde uygulama
 * normal çalışmaya devam eder — Sentry hesabı olmadan sistem açılamaz hale
 * gelmez.
 *
 * ⚠️ KVKK: Sentry'ye giden veriden telefon numaraları ve kimlik bilgileri
 * ayıklanıyor (`beforeSend`). `sendDefaultPii` de kapalı — Sentry'nin
 * kendiliğinden IP/çerez/başlık toplamasını istemiyoruz. Bir hata raporu
 * müşterinin telefon numarasını içerirse, o numara üçüncü taraf bir
 * sunucuya kopyalanmış olur; logger'daki `redact` listesiyle aynı gerekçe.
 */

/** Bu adlara sahip alanlar Sentry'ye gitmeden önce silinir. */
const SENSITIVE_KEYS = new Set([
  'phone',
  'customerPhone',
  'contactPhone',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'authorization',
  'cookie',
]);

/** Nesneyi derinlemesine gezip hassas alanları maskeler. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key) ? '[gizlendi]' : scrub(val, depth + 1);
  }
  return out;
}

export function initSentry(): void {
  if (isTest || !env.SENTRY_DSN) {
    if (!isTest && isProduction) {
      logger.warn('SENTRY_DSN tanımlı değil — hata izleme devre dışı, hatalar yalnızca loglara yazılacak');
    }
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Kişisel veri toplama kapalı — IP, çerez, başlıklar gönderilmesin.
    sendDefaultPii: false,
    // Tek dükkanlı düşük trafikli sistem: her hata değerli, örnekleme yok.
    // Performans izleme (tracing) kapalı — ek maliyet ve gürültü getiriyor,
    // bu ölçekte fayda sağlamıyor.
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        if (event.request.data) event.request.data = scrub(event.request.data);
      }
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
      return event;
    },
  });

  logger.info('Sentry hata izleme etkin');
}

/** Sentry kapalıysa hiçbir şey yapmaz — çağıran tarafın kontrol etmesi gerekmiyor. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!env.SENTRY_DSN || isTest) return;

  Sentry.captureException(error, context ? { extra: scrub(context) as Record<string, unknown> } : undefined);
}

/** Kapanışta bekleyen olayların gönderilmesini bekler. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!env.SENTRY_DSN || isTest) return;

  try {
    await Sentry.flush(timeoutMs);
  } catch {
    /* kapanışı geciktirmeye değmez */
  }
}
