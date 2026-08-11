import { verify as verifyPassword, hash as hashPassword } from '@node-rs/argon2';
import type { BarberRole } from '@berber/shared';
import { prisma } from '../db/client.js';
import { UnauthorizedError, ForbiddenError, ValidationError } from '../lib/errors.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} from '../lib/tokens.js';
import { logger } from '../lib/logger.js';

/**
 * Kimlik doğrulama iş mantığı.
 *
 * Tüm kontroller SUNUCU tarafında. Deneme sayacı, kilit süresi ve rol bilgisi
 * istemciden gelen hiçbir veriye güvenmez.
 */

/** Bu kadar hatalı denemeden sonra hesap kilitlenir. */
const MAX_FAILED_ATTEMPTS = 5;

/** Kilit süresi (dakika). */
const LOCK_DURATION_MIN = 15;

/**
 * Kullanıcı bulunamadığında da parola doğrulaması yapılmış gibi zaman
 * harcamak için kullanılan sahte özet.
 *
 * Neden: e-posta yoksa hemen dönersek yanıt belirgin biçimde hızlı olur.
 * Saldırgan bu süre farkından hangi e-postaların kayıtlı olduğunu çıkarabilir.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8Y8kZ0zHqQxJZGVtbzEyMzQ1Njc4OTBhYmNkZWY';

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface AuthenticatedBarber {
  id: string;
  shopId: string;
  name: string;
  email: string;
  role: BarberRole;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  barber: AuthenticatedBarber;
}

/** Giriş hatalarında kullanıcıya dönen tek mesaj. */
const GENERIC_LOGIN_ERROR = 'E-posta veya şifre hatalı';

export async function login(
  email: string,
  password: string,
  userAgent?: string,
): Promise<LoginResult> {
  const barber = await prisma.barber.findFirst({
    where: { email },
  });

  // ── Kullanıcı yok ────────────────────────────────────
  if (!barber) {
    // Zaman farkı yaratmamak için yine de bir doğrulama yapıyoruz.
    await verifyPassword(DUMMY_HASH, password).catch(() => false);
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR);
  }

  // ── Hesap kilitli mi? ────────────────────────────────
  if (barber.lockedUntil && barber.lockedUntil > new Date()) {
    const remainingMin = Math.ceil((barber.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new ForbiddenError(
      `Çok fazla hatalı deneme yapıldı. Hesabınız ${remainingMin} dakika daha kilitli.`,
    );
  }

  // ── Hesap pasif mi? ──────────────────────────────────
  // Kilit kontrolünden sonra: pasif hesaba özel mesaj vermek, hangi
  // e-postaların kayıtlı olduğunu ele verirdi.
  if (!barber.isActive) {
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR);
  }

  // ── Parola ───────────────────────────────────────────
  const passwordOk = await verifyPassword(barber.passwordHash, password).catch(() => false);

  if (!passwordOk) {
    await registerFailedAttempt(barber.id, barber.failedLoginCount);
    throw new UnauthorizedError(GENERIC_LOGIN_ERROR);
  }

  // ── Başarılı giriş ───────────────────────────────────
  if (barber.failedLoginCount > 0 || barber.lockedUntil) {
    await prisma.barber.update({
      where: { id: barber.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  const rawRefreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      barberId: barber.id,
      tokenHash: hashRefreshToken(rawRefreshToken),
      expiresAt: refreshTokenExpiry(),
      userAgent: userAgent ?? null,
    },
  });

  logger.info({ barberId: barber.id }, 'Giriş yapıldı');

  return {
    accessToken: signAccessToken({
      barberId: barber.id,
      shopId: barber.shopId,
      role: barber.role,
    }),
    refreshToken: rawRefreshToken,
    barber: {
      id: barber.id,
      shopId: barber.shopId,
      name: barber.name,
      email: barber.email,
      role: barber.role,
    },
  };
}

async function registerFailedAttempt(barberId: string, currentCount: number): Promise<void> {
  const newCount = currentCount + 1;
  const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;

  await prisma.barber.update({
    where: { id: barberId },
    data: {
      failedLoginCount: newCount,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MIN * 60_000) : null,
    },
  });

  if (shouldLock) {
    logger.warn({ barberId, attempts: newCount }, 'Hesap kilitlendi');
  }
}

/**
 * Yenileme jetonunu kullanarak yeni bir çift üretir.
 *
 * Jeton ROTASYONU uygulanıyor: kullanılan jeton iptal edilip yenisi veriliyor.
 * Böylece çalınan bir jeton en fazla bir kez kullanılabilir.
 */
export async function refresh(
  rawToken: string,
  userAgent?: string,
): Promise<LoginResult> {
  const tokenHash = hashRefreshToken(rawToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { barber: true },
  });

  if (!stored) {
    throw new UnauthorizedError('Oturumunuz geçersiz. Lütfen tekrar giriş yapın.');
  }

  // ── Yeniden kullanım tespiti ─────────────────────────
  // İptal edilmiş bir jeton yeniden sunulduysa, jeton çalınmış olabilir:
  // meşru kullanıcı yenilediği için eski jeton iptal edilmişti, şimdi biri
  // onu kullanmaya çalışıyor. Bu durumda o kullanıcının TÜM oturumlarını
  // kapatıyoruz.
  if (stored.revokedAt) {
    logger.warn(
      { barberId: stored.barberId },
      'İptal edilmiş yenileme jetonu kullanıldı — tüm oturumlar kapatılıyor',
    );
    await revokeAllForBarber(stored.barberId);
    throw new UnauthorizedError('Oturumunuz geçersiz. Lütfen tekrar giriş yapın.');
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Oturum süreniz doldu. Lütfen tekrar giriş yapın.');
  }

  if (!stored.barber.isActive) {
    await revokeAllForBarber(stored.barberId);
    throw new UnauthorizedError('Hesabınız devre dışı.');
  }

  const newRawToken = generateRefreshToken();

  // Eski jetonu iptal et ve yenisini oluştur — tek transaction'da, böylece
  // araya bir hata girerse iki jeton birden geçerli kalmaz.
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        barberId: stored.barberId,
        tokenHash: hashRefreshToken(newRawToken),
        expiresAt: refreshTokenExpiry(),
        userAgent: userAgent ?? null,
      },
    }),
  ]);

  return {
    accessToken: signAccessToken({
      barberId: stored.barber.id,
      shopId: stored.barber.shopId,
      role: stored.barber.role,
    }),
    refreshToken: newRawToken,
    barber: {
      id: stored.barber.id,
      shopId: stored.barber.shopId,
      name: stored.barber.name,
      email: stored.barber.email,
      role: stored.barber.role,
    },
  };
}

export async function logout(rawToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(rawToken);

  // Jeton yoksa da hata vermiyoruz — çıkış her hâlükârda başarılı sayılır.
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function revokeAllForBarber(barberId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { barberId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Kendi şifresini değiştirme. Tüm diğer oturumları kapatır. */
export async function changePassword(
  barberId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const barber = await prisma.barber.findUnique({ where: { id: barberId } });
  if (!barber) {
    throw new UnauthorizedError();
  }

  const ok = await verifyPassword(barber.passwordHash, currentPassword).catch(() => false);
  if (!ok) {
    throw new ValidationError('Mevcut şifreniz hatalı');
  }

  const newHash = await hashPassword(newPassword, ARGON2_OPTIONS);

  await prisma.$transaction([
    prisma.barber.update({
      where: { id: barberId },
      data: { passwordHash: newHash },
    }),
    // Şifre değişince diğer cihazlardaki oturumlar düşsün
    prisma.refreshToken.updateMany({
      where: { barberId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  logger.info({ barberId }, 'Şifre değiştirildi, tüm oturumlar kapatıldı');
}
