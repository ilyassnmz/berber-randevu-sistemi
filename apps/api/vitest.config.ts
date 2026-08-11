import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Yalnızca birim testleri. Veritabanı gerektiren entegrasyon testleri
    // vitest.integration.config.ts ile ayrı çalışır.
    include: ['src/**/*.test.ts'],
    // Testlerde gerçek env doğrulaması çalışmasın diye asgari değerler
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-secret-en-az-otuz-iki-karakter-olmali-tamam',
    },
  },
});
