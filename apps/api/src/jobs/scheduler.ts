import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger.js';
import { captureError } from '../lib/sentry.js';
import { sendDayReminders, sendHourReminders } from './reminders.js';
import { expirePendingAppointments, cleanupExpired } from './cleanup.js';

/**
 * Zamanlanmış işler.
 *
 * Her iş `withJobLock` ile sarmalanmış durumda kendi dosyasında —
 * burada yalnızca zamanlama var. Bir işin atılan hatası diğerlerini
 * durdurmasın diye her çağrı ayrı ayrı try/catch içinde.
 */

function runSafely(name: string, fn: () => Promise<'ran' | 'skipped'>): void {
  fn()
    .then((result) => {
      if (result === 'ran') logger.debug({ job: name }, 'Zamanlanmış iş tamamlandı');
    })
    .catch((error: unknown) => {
      // Cron işleri istek dışında çalışıyor — hataları error-handler
      // middleware'ine hiç uğramıyor, bu yüzden Sentry'ye buradan
      // bildirilmeleri gerekiyor. Sessizce başarısız olan bir hatırlatma
      // işi, fark edilmesi en zor arıza türü.
      logger.error({ err: error, job: name }, 'Zamanlanmış iş hata verdi');
      captureError(error, { job: name });
    });
}

let tasks: ScheduledTask[] = [];

export function startScheduler(): void {
  if (tasks.length > 0) return; // zaten başlatılmış

  tasks = [
    // Her 5 dakikada: 1 gün ve 1 saat önce hatırlatmalar
    cron.schedule('*/5 * * * *', () => runSafely('reminder_1day', sendDayReminders)),
    cron.schedule('*/5 * * * *', () => runSafely('reminder_1hour', sendHourReminders)),

    // Her dakika: onay süresi dolan randevuları temizle
    cron.schedule('* * * * *', () => runSafely('expire_pending', expirePendingAppointments)),

    // Her gece 03:00: süresi dolmuş oturum/jeton temizliği
    cron.schedule('0 3 * * *', () => runSafely('cleanup_expired', cleanupExpired)),
  ];

  logger.info('Zamanlayıcı başlatıldı (hatırlatmalar, temizlik)');
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks = [];
}
