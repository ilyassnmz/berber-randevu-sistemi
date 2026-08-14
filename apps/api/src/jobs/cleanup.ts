import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { withJobLock } from './lock.js';
import { AUDIT_ACTIONS, recordAudit } from '../services/audit.js';

/**
 * Süresi dolmuş `pending_confirm` randevuları iptal eder.
 *
 * Chatbot, özet ekranını gösterirken randevuyu `pending_confirm` olarak
 * rezerve ediyor (chatbot/handler.ts → showConfirmation); "Onayla" ile
 * `confirmed`'e geçiyor. Müşteri `confirmTimeoutMin` (varsayılan 5 dk)
 * içinde yanıt vermezse rezervasyon burada iptal edilir ve slot serbest
 * kalır.
 */
export async function expirePendingAppointments(): Promise<'ran' | 'skipped'> {
  return withJobLock('expire_pending_appointments', async () => {
    const now = new Date();

    const expired = await prisma.appointment.findMany({
      where: { status: 'pending_confirm', confirmDeadline: { lt: now } },
      select: { id: true, shopId: true },
    });

    for (const appt of expired) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: {
          status: 'cancelled',
          cancelledBy: 'system',
          cancelReason: 'Onay süresi doldu',
          cancelledAt: now,
        },
      });

      await recordAudit({
        shopId: appt.shopId,
        actorId: null,
        action: AUDIT_ACTIONS.APPOINTMENT_CANCEL,
        entityType: 'appointment',
        entityId: appt.id,
        metadata: { reason: 'confirm_timeout' },
      });
    }

    if (expired.length > 0) {
      logger.info({ count: expired.length }, 'Onay süresi dolan randevular iptal edildi');
    }
  });
}

/** Süresi dolmuş chatbot oturumlarını ve yenileme jetonlarını temizler. */
export async function cleanupExpired(): Promise<'ran' | 'skipped'> {
  return withJobLock('cleanup_expired', async () => {
    const now = new Date();

    const [sessions, tokens, idempotencyKeys] = await Promise.all([
      prisma.chatSession.deleteMany({ where: { expiresAt: { lt: now } } }),
      // Süresi dolalı en az 7 gün olmuş jetonları sil — daha yenisi, hata
      // ayıklarken "az önce kim çıkış yaptı" sorusuna cevap verebilsin diye
      // bir süre tutuluyor.
      prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);

    if (sessions.count > 0 || tokens.count > 0 || idempotencyKeys.count > 0) {
      logger.info(
        {
          chatSessions: sessions.count,
          refreshTokens: tokens.count,
          idempotencyKeys: idempotencyKeys.count,
        },
        'Süresi dolmuş kayıtlar temizlendi',
      );
    }
  });
}
