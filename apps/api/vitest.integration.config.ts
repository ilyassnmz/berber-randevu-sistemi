import { defineConfig } from 'vitest/config';

/**
 * Entegrasyon testleri — GERÇEK veritabanına bağlanır.
 *
 * Ayrı tutulmalarının sebebi: birim testleri saniyeler içinde ve her yerde
 * çalışabilmeli. Bunlar ise .env'deki DATABASE_URL'e ihtiyaç duyar.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Koşu başlamadan önce önceki koşuların artıklarını süpürür.
    globalSetup: ['./tests/global-setup.ts'],
    // Aynı tabloya yazan testler birbirini bozmasın
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
