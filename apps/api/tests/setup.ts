/**
 * Entegrasyon testleri için ortam hazırlığı.
 *
 * `.env` dosyasını process.env'e yükler. Node 22'nin yerleşik
 * `process.loadEnvFile()` fonksiyonu kullanılıyor — ek bağımlılık yok.
 */

try {
  process.loadEnvFile();
} catch {
  throw new Error(
    'apps/api/.env bulunamadı. Entegrasyon testleri gerçek bir veritabanı ister.\n' +
      '.env.example dosyasını .env olarak kopyalayıp DATABASE_URL değerini doldurun.',
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL tanımlı değil — entegrasyon testleri çalıştırılamaz.');
}

// env.ts üretim kontrollerini tetiklemesin
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-en-az-otuz-iki-karakter-olmali-tamam';
