import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, changePasswordSchema } from '@berber/shared';
import { login, refresh, logout, changePassword } from '../services/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { UnauthorizedError } from '../lib/errors.js';
import { isProduction, isTest, env } from '../config/env.js';
import { prisma } from '../db/client.js';

export const authRouter: Router = Router();

const REFRESH_COOKIE = 'berber_refresh';

/**
 * Yenileme jetonu çerezi.
 *
 *   httpOnly  → JavaScript okuyamaz, XSS ile çalınamaz
 *   secure    → yalnızca HTTPS üzerinden gider (üretimde)
 *   sameSite  → başka sitelerden gelen isteklerde gönderilmez (CSRF koruması)
 *   path      → yalnızca auth uçlarına gönderilir, her isteğe eklenmez
 */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

/**
 * Giriş denemelerine ayrı ve sıkı bir hız sınırı.
 * Genel /api sınırı (dakikada 60) kaba kuvvet için fazla cömert kalırdı.
 */
const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  // Testlerde devre dışı: hesap kilitleme senaryosu kasten çok sayıda hatalı
  // deneme yapıyor ve IP bazlı sınır bunu engellerdi.
  skip: () => isTest,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Çok fazla giriş denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin.',
    },
  },
});

authRouter.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const result = await login(email, password, req.headers['user-agent']);

    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());

    // Erişim jetonu gövdede dönüyor; istemci onu BELLEKTE tutar,
    // localStorage'a yazmaz.
    res.json({
      accessToken: result.accessToken,
      barber: result.barber,
    });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    if (!token) {
      throw new UnauthorizedError('Oturum bulunamadı. Lütfen giriş yapın.');
    }

    const result = await refresh(token, req.headers['user-agent']);

    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    res.json({
      accessToken: result.accessToken,
      barber: result.barber,
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;

    if (token) {
      await logout(token);
    }

    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  }),
);

/** Oturumdaki berberin bilgileri. Panel açılışta bunu çağırır. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const barber = await prisma.barber.findUnique({
      where: { id: req.auth!.barberId },
      select: { id: true, shopId: true, name: true, email: true, role: true, isActive: true },
    });

    if (!barber || !barber.isActive) {
      throw new UnauthorizedError();
    }

    res.json({ barber });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    await changePassword(req.auth!.barberId, currentPassword, newPassword);

    // Tüm oturumlar kapatıldı; bu cihazınki de dahil.
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    res.json({ ok: true, message: 'Şifreniz değiştirildi. Lütfen tekrar giriş yapın.' });
  }),
);
