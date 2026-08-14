import type { RequestHandler, Request } from 'express';
import { BARBER_ROLE, type BarberRole } from '@berber/shared';
import { verifyAccessToken } from '../lib/tokens.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';

/**
 * Kimlik doğrulama ve yetki ara katmanları.
 */

/**
 * `req.auth`'un Express'ten bağımsız hali — servis katmanı Express
 * tiplerine bağlanmadan bunu kullanabilsin diye ayrı tanımlı.
 */
export interface AuthContext {
  barberId: string;
  shopId: string;
  role: BarberRole;
}

/** `Authorization: Bearer <token>` başlığından jetonu çıkarır. */
function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Geçerli erişim jetonu şart. `req.auth` doldurulur. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    next(new UnauthorizedError());
    return;
  }

  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
};

/** Yalnızca `admin` rolü. Ayarlar ve istatistik ekranları için. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(new UnauthorizedError());
    return;
  }

  if (req.auth.role !== BARBER_ROLE.ADMIN) {
    next(new ForbiddenError('Bu işlem için yönetici yetkisi gerekiyor'));
    return;
  }

  next();
};

/**
 * Bir berberin, başka bir berberin verisine erişip erişemeyeceğini belirler.
 *
 * `admin` (Müslüm) herkesin verisini görür; `staff` (Fırat) yalnızca kendisininkini.
 *
 * ⚠️ Bu kontrol rota seviyesinde bırakılmıyor, servis katmanında da çağrılıyor.
 * Tek katmanlı yetki kontrolü, yeni bir rota eklendiğinde unutulmaya açıktır.
 */
export function assertCanAccessBarber(auth: AuthContext, targetBarberId: string): void {
  if (auth.role === BARBER_ROLE.ADMIN) return;
  if (auth.barberId === targetBarberId) return;

  throw new ForbiddenError('Yalnızca kendi randevularınıza erişebilirsiniz');
}

/**
 * Liste sorguları için berber filtresini çözer.
 *
 * `staff` ne isterse istesin kendi kimliğine sabitlenir — istemciden gelen
 * `barberId` parametresine güvenilmez.
 */
export function resolveBarberFilter(
  auth: AuthContext,
  requestedBarberId?: string,
): string | undefined {
  if (auth.role !== BARBER_ROLE.ADMIN) {
    return auth.barberId;
  }
  return requestedBarberId;
}
