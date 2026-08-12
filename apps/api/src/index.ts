import { createApp } from './app.js';
import { env, isWhatsAppConfigured } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectDatabase } from './db/client.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      whatsapp: isWhatsAppConfigured ? 'yapılandırıldı' : 'devre dışı',
    },
    `API çalışıyor → http://localhost:${env.PORT}`,
  );

  if (!isWhatsAppConfigured) {
    logger.warn(
      'WhatsApp ayarları eksik — bot devre dışı. Panel ve API normal çalışır. ' +
        'Ayarlar için .env.example dosyasına bakın.',
    );
  }

  startScheduler();
});

/**
 * Düzgün kapanma.
 *
 * SIGTERM geldiğinde (deploy, yeniden başlatma) yeni istek almayı bırakıp
 * işlenmekte olanları bitiriyoruz. Bu olmadan deploy sırasındaki istekler
 * yarıda kesilir — randevu oluşturmanın ortasında kesilirse müşteri onay
 * mesajı almadan kayıt oluşmuş olabilir.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Kapanma başlatıldı, açık istekler bekleniyor');
  stopScheduler();

  const forceExit = setTimeout(() => {
    logger.error('Açık istekler 15 saniyede bitmedi, zorla kapatılıyor');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Sunucu kapatılırken hata');
      process.exit(1);
    }

    try {
      await disconnectDatabase();
      logger.info('Kapanma tamamlandı');
      process.exit(0);
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Veritabanı bağlantısı kapatılamadı');
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Yakalanmamış promise reddi');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Yakalanmamış istisna');
  void shutdown('uncaughtException');
});
