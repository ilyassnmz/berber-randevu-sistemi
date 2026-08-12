import { prisma } from '../db/client.js';
import { formatLocalTime } from '../lib/time.js';
import { sendTemplateToCustomer } from '../services/whatsapp/messaging.js';
import { logger } from '../lib/logger.js';
import { withJobLock } from './lock.js';

/**
 * Hatırlatma işleri.
 *
 * ⚠️ Serbest metin DEĞİL, her zaman şablon (`sendTemplateToCustomer`)
 * kullanılıyor. "Yarın randevunuz var" mesajı WhatsApp'ın 24 saatlik serbest
 * mesaj penceresinin tanımı gereği her zaman dışındadır — bkz.
 * services/whatsapp/templates.ts.
 *
 * ⚠️ Zaman penceresi = job'ın çalışma sıklığıyla eşleşmeli (5 dk). İş her
 * 5 dakikada bir tetiklenir ve o an "hedef ana 5 dakikadan az kalmış"
 * randevuları yakalar. Bayrak (`reminder1DaySentAt` / `..1HourSentAt`)
 * GÖNDERMEDEN ÖNCE yazılır — sunucu gönderim sırasında çökerse en fazla
 * bir hatırlatma kaçar, asla iki kez gitmez.
 */

const WINDOW_MIN = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export async function sendDayReminders(): Promise<'ran' | 'skipped'> {
  return withJobLock('reminder_1day', async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() + DAY_MS);
    const windowEnd = new Date(windowStart.getTime() + WINDOW_MIN * 60_000);

    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'confirmed',
        startsAt: { gte: windowStart, lt: windowEnd },
        reminder1DaySentAt: null,
      },
      include: { customer: true, barber: true, shop: true },
    });

    for (const appt of appointments) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminder1DaySentAt: now },
      });

      if (appt.customer.optedOut) continue;

      const result = await sendTemplateToCustomer(appt.customerId, 'REMINDER_1_DAY', [
        formatLocalTime(appt.startsAt, appt.shop.timezone),
        appt.barber.name,
      ]);

      if (!result.sent) {
        logger.warn(
          { appointmentId: appt.id, reason: result.reason },
          '1 günlük hatırlatma gönderilemedi',
        );
      }
    }

    if (appointments.length > 0) {
      logger.info({ count: appointments.length }, '1 günlük hatırlatmalar işlendi');
    }
  });
}

export async function sendHourReminders(): Promise<'ran' | 'skipped'> {
  return withJobLock('reminder_1hour', async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() + HOUR_MS);
    const windowEnd = new Date(windowStart.getTime() + WINDOW_MIN * 60_000);

    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'confirmed',
        startsAt: { gte: windowStart, lt: windowEnd },
        reminder1HourSentAt: null,
      },
      include: { customer: true, barber: true, shop: true },
    });

    for (const appt of appointments) {
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminder1HourSentAt: now },
      });

      if (appt.customer.optedOut) continue;

      const result = await sendTemplateToCustomer(appt.customerId, 'REMINDER_1_HOUR', [
        formatLocalTime(appt.startsAt, appt.shop.timezone),
        appt.barber.name,
      ]);

      if (!result.sent) {
        logger.warn(
          { appointmentId: appt.id, reason: result.reason },
          '1 saatlik hatırlatma gönderilemedi',
        );
      }
    }

    if (appointments.length > 0) {
      logger.info({ count: appointments.length }, '1 saatlik hatırlatmalar işlendi');
    }
  });
}
