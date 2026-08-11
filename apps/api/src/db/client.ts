import { PrismaClient } from '@prisma/client';
import { isProduction } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Prisma istemcisi (tekil).
 *
 * `tsx watch` geliştirme sırasında modülleri yeniden yüklüyor; global'de
 * saklamazsak her yeniden yüklemede yeni bir bağlantı havuzu açılır ve
 * veritabanı bağlantı limitine takılırız.
 */

/**
 * İstemciyi fabrika fonksiyonu üzerinden kuruyoruz.
 *
 * Prisma, `$on` ile dinlenebilecek olayların tiplerini `log` seçeneğindeki
 * literal'den türetir. Global değişkeni düz `PrismaClient` olarak tiplersek
 * `??` birleşimi bu bilgiyi kaybeder ve `$on` yalnızca `never` kabul eder.
 */
function createPrismaClient() {
  return new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as { prisma?: AppPrismaClient };

export const prisma: AppPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

prisma.$on('error', (e) => {
  logger.error({ prisma: e }, 'Veritabanı hatası');
});

prisma.$on('warn', (e) => {
  // Üretimde uyarılar gürültü yapmasın; geliştirmede görünsün.
  if (!isProduction) logger.warn({ prisma: e }, 'Veritabanı uyarısı');
});

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Sağlık kontrolü — bağlantı gerçekten çalışıyor mu? */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Veritabanı bağlantı kontrolü başarısız');
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
