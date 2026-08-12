import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * Satır tabanlı iş kilidi — tek örnek güvenliği.
 *
 * ⚠️ `reminder1DaySentAt` gibi bir bayrak TEK BAŞINA yeterli değil. Sunucu,
 * gönderim ile bayrak güncellemesi arasında yeniden başlarsa (deploy,
 * çökme) hatırlatma iki kez gider. Bu kilit aynı işin paralel — ya da art
 * arda hızlı — iki kez çalışmasını engelliyor; kilit alınamazsa iş
 * sessizce atlanır (bir sonraki tick'te tekrar dener).
 *
 * ⚠️ Neden Postgres'in `pg_try_advisory_lock`'ı değil? O, oturum
 * seviyesinde çalışır ve kilitleme ile kilit açma çağrılarının AYNI
 * veritabanı bağlantısından gitmesini gerektirir. Neon'un havuzlanmış
 * bağlantısı (PgBouncer, transaction modu) her sorguyu farklı bir fiziksel
 * bağlantıya yönlendirebiliyor — ölçüldüğünde bu yüzden iki eşzamanlı
 * çağrının ikisi de kilidi alabildiği görüldü. `job_locks` tablosuna
 * atomik `INSERT ... ON CONFLICT` ise sıradan bir DML işlemi olduğu için
 * havuzlamadan etkilenmiyor.
 */

/** Bir kilit en fazla bu kadar tutulur — çöken bir süreç kilidi sonsuza dek elde tutmasın. */
const MAX_LOCK_DURATION_MS = 5 * 60_000;

export async function withJobLock(
  jobName: string,
  fn: () => Promise<void>,
): Promise<'ran' | 'skipped'> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + MAX_LOCK_DURATION_MS);

  // Kilit yoksa oluşturur; varsa ve süresi dolmuşsa (çöken bir önceki
  // çalıştırmadan kalmış) devralır; hâlâ geçerliyse hiçbir satırı etkilemez.
  const acquired = await prisma.$queryRaw<Array<{ name: string }>>`
    INSERT INTO "job_locks" ("name", "locked_until")
    VALUES (${jobName}, ${lockedUntil})
    ON CONFLICT ("name") DO UPDATE
      SET "locked_until" = EXCLUDED."locked_until"
      WHERE "job_locks"."locked_until" < ${now}
    RETURNING "name"
  `;

  if (acquired.length === 0) {
    logger.debug({ job: jobName }, 'Kilit alınamadı, iş atlanıyor');
    return 'skipped';
  }

  try {
    await fn();
    return 'ran';
  } finally {
    // Kilidi hemen serbest bırak — sonraki tick MAX_LOCK_DURATION_MS kadar
    // beklemek zorunda kalmasın. Bu başarısız olsa bile süre dolunca
    // kendiliğinden serbest kalır.
    await prisma.jobLock
      .updateMany({ where: { name: jobName }, data: { lockedUntil: new Date(0) } })
      .catch((error: unknown) => {
        logger.warn({ err: error, job: jobName }, 'Kilit erken serbest bırakılamadı');
      });
  }
}
