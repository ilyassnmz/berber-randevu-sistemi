import cron, { type ScheduledTask } from 'node-cron';
import { isWhatsAppConfigured } from '../config/env.js';
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
    // Her gece 03:00: süresi dolmuş oturum/jeton/idempotency kaydı temizliği.
    // WhatsApp'tan bağımsız — panel oturumları her hâlükârda birikiyor.
    cron.schedule('0 3 * * *', () => runSafely('cleanup_expired', cleanupExpired)),
  ];

  /**
   * ⚠️ Aşağıdaki üç iş yalnızca WhatsApp yapılandırılmışken çalışır.
   *
   * ── Neden? Bu bir maliyet kararı, üslup tercihi değil. ────────────
   *
   * Üçü de WhatsApp'a bağlı: hatırlatmalar şablon mesajı gönderiyor,
   * `expire_pending` ise yalnızca chatbot'un ürettiği `pending_confirm`
   * randevularını süpürüyor (siteden ve panelden gelen randevular doğrudan
   * `confirmed` açılıyor — bkz. services/public-booking.ts). Cloud API
   * kapalıyken üçü de çalışıp hiçbir şey bulamıyordu.
   *
   * Bunun bedeli görünmezdi ve ağırdı: `expire_pending` her DAKİKA
   * çalışıyor ve ilk işi `job_locks` tablosuna yazmak (bkz. jobs/lock.ts).
   * Yani veritabanına 60 saniyede bir yazma gidiyordu.
   *
   * Neon işlem SÜRESİ üzerinden ücretlendiriyor ve boşta kalınca computeʼu
   * uyutuyor. Dakikada bir yazma, o sessizliğin hiç oluşmaması demek:
   * veritabanı ayda 720 saat açık kaldı, ücretsiz plandaki 100 CU-saatlik
   * (0,25 CU'da ~400 saat) hak ayın ortasında bitti ve Neon veritabanını
   * kapattı. Site 31 Ağustos 2026'da müşterilere hata verdi.
   *
   * Günlük 2017 gereksiz çalıştırma buradan siliniyor; geriye tek bir
   * gecelik temizlik kalıyor. WhatsApp ileride bağlanırsa üç iş de
   * kendiliğinden geri geliyor — elle açılması gereken bir şey yok.
   */
  if (isWhatsAppConfigured) {
    tasks.push(
      // Her 5 dakikada: 1 gün ve 1 saat önce hatırlatmalar
      cron.schedule('*/5 * * * *', () => runSafely('reminder_1day', sendDayReminders)),
      cron.schedule('*/5 * * * *', () => runSafely('reminder_1hour', sendHourReminders)),

      // Her dakika: onay süresi dolan randevuları temizle
      cron.schedule('* * * * *', () => runSafely('expire_pending', expirePendingAppointments)),
    );
  }

  logger.info(
    { whatsappIsleri: isWhatsAppConfigured },
    isWhatsAppConfigured
      ? 'Zamanlayıcı başlatıldı (hatırlatmalar, onay süresi, temizlik)'
      : 'Zamanlayıcı başlatıldı (yalnızca gecelik temizlik — WhatsApp kapalı, ' +
          'hatırlatma ve onay süresi işleri gereksiz veritabanı trafiği yaratmasın diye kapalı)',
  );
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks = [];
}
