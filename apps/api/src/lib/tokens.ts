import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import type { BarberRole } from '@berber/shared';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

/**
 * Jeton üretimi ve doğrulaması.
 *
 * İki farklı jeton kullanılıyor, çünkü ikisinin tehdit modeli farklı:
 *
 *   Erişim jetonu (access)   — 15 dakika, imzalı JWT, istemcide BELLEKTE durur.
 *                              Çalınsa bile 15 dakika sonra işe yaramaz.
 *
 *   Yenileme jetonu (refresh) — 30 gün, rastgele bayt, veritabanında SHA-256
 *                              özeti tutulur, httpOnly cookie ile taşınır.
 *                              JavaScript erişemez → XSS ile çalınamaz.
 *                              Veritabanında durduğu için İPTAL EDİLEBİLİR.
 *
 * v1 planındaki "30 günlük JWT'yi localStorage'a koy" yaklaşımının iki sorunu
 * vardı: XSS ile okunabiliyordu ve çalındıktan sonra iptal edilemiyordu.
 */

export interface AccessTokenPayload {
  barberId: string;
  shopId: string;
  role: BarberRole;
}

interface AccessTokenClaims extends AccessTokenPayload {
  iat: number;
  exp: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    algorithm: 'HS256',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      // Algoritmayı sabitliyoruz. Aksi halde saldırgan `alg: none` ile
      // imzasız jeton kabul ettirmeyi deneyebilir.
      algorithms: ['HS256'],
    }) as AccessTokenClaims;

    return {
      barberId: decoded.barberId,
      shopId: decoded.shopId,
      role: decoded.role,
    };
  } catch {
    // Hatanın türünü (süresi doldu / imza geçersiz) istemciye söylemiyoruz.
    throw new UnauthorizedError('Oturumunuz geçersiz. Lütfen tekrar giriş yapın.');
  }
}

// ─── Yenileme jetonu ─────────────────────────────────────

/** Kriptografik olarak güvenli, tahmin edilemez jeton üretir. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Veritabanında saklanacak özet.
 *
 * Ham jeton saklanmaz: veritabanı sızarsa saldırgan doğrudan oturum açamasın.
 * Parolalardan farklı olarak burada argon2 gerekmez — jeton zaten 256 bit
 * rastgele, kaba kuvvetle bulunamaz; SHA-256 yeterli ve hızlı.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}
