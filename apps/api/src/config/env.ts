import { z } from 'zod';

/**
 * Ortam değişkeni doğrulaması.
 *
 * Amaç: eksik veya hatalı yapılandırmada uygulama AÇILIŞTA ölsün.
 * Aksi halde `process.env.JWT_SECRET` değeri `undefined` olarak akar ve hata
 * aylar sonra, üretimde, en kötü anda ortaya çıkar.
 */

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

const baseSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL zorunlu'),
  /** Neon havuzlanmış bağlantı kullanılırken migration'lar için doğrudan bağlantı. */
  DIRECT_DATABASE_URL: z.string().optional(),

  /** Panelin çalıştığı adres(ler). Virgülle ayrılır. CORS allowlist'i budur. */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  /**
   * Erişim jetonu imza anahtarı. Kısa ömürlü jetonlar için.
   * Üretmek için: openssl rand -base64 48
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET en az 32 karakter olmalı'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** WhatsApp Cloud API */
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  /**
   * Meta App Secret. Webhook imzasını (X-Hub-Signature-256) doğrulamak için.
   * Bu olmadan webhook'a herkes sahte mesaj gönderebilir.
   */
  WHATSAPP_APP_SECRET: z.string().optional(),
  /** Meta'nın GET doğrulama handshake'inde beklediği jeton. */
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),

  SENTRY_DSN: z.string().optional(),
});

/**
 * Üretimde WhatsApp ve Sentry ayarları zorunlu hale gelir.
 * Geliştirme sırasında bot olmadan da çalışabilmek gerekiyor.
 */
const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;

  const requiredInProd = [
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_VERIFY_TOKEN',
  ] as const;

  for (const key of requiredInProd) {
    if (!env[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} üretim ortamında zorunlu`,
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Logger henüz kurulmamış olabilir; doğrudan stderr'e yazıyoruz.
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(kök)'}: ${i.message}`)
      .join('\n');

    process.stderr.write(
      `\n✖ Ortam değişkenleri geçersiz — uygulama başlatılamıyor:\n\n${issues}\n\n` +
        `  .env.example dosyasını .env olarak kopyalayıp doldurun.\n\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** CORS allowlist'i dizi olarak. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** WhatsApp yapılandırması tam mı? Değilse bot devre dışı çalışır. */
export const isWhatsAppConfigured = Boolean(
  env.WHATSAPP_PHONE_NUMBER_ID &&
    env.WHATSAPP_ACCESS_TOKEN &&
    env.WHATSAPP_APP_SECRET &&
    env.WHATSAPP_VERIFY_TOKEN,
);
