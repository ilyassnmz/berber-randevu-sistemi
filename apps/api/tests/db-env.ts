/**
 * Entegrasyon testlerini TEST veritabanına yönlendirir ve üretime
 * bağlanmalarını imkânsız kılar.
 *
 * ── Neden bu kadar sert? ──────────────────────────────────────────
 *
 * Testler `deleteMany` çalıştırıyor ve sahte dükkan/müşteri/randevu
 * yazıyor. Bir dönem üretimle aynı veritabanına bağlanıyorlardı ve bu
 * gerçekten zarar verdi: yarıda kesilen bir koşudan kalan test dükkanı,
 * müşteri sitesini "randevu sistemine ulaşılamıyor" ekranına düşürdü.
 * Daha kötüsü, her koşu SÜRESİNCE site zaten hatalıydı.
 *
 * Bu yüzden burada sessiz bir varsayılan YOK. Yapılandırma eksik ya da
 * şüpheliyse testler hiç çalışmaz; yanlış veritabanına yazmaktansa
 * çalışmaması tercih edilir.
 */

/**
 * Yönlendirmenin yapıldığını işaretler.
 *
 * ⚠️ Modül seviyesinde bir değişken YETMEZ: vitest'te `globalSetup` ve
 * `setupFiles` ayrı modül grafiklerinde çalışıyor, her biri kendi
 * kopyasını görürdü. `process.env` ikisinin paylaştığı tek yer.
 *
 * Bu işaret olmadan fonksiyon ikinci kez çağrıldığında DATABASE_URL'i
 * zaten test veritabanına çevrilmiş halde buluyor, "test ve üretim aynı"
 * sanıp yanlışlıkla alarma geçiyordu.
 */
const ISARET = '__OZDEDE_TEST_DB_YONLENDIRILDI';

function veritabaniAdi(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

export function testVeritabaninaYonlendir(): void {
  if (process.env[ISARET] === '1') return;

  try {
    process.loadEnvFile();
  } catch {
    throw new Error(
      'apps/api/.env bulunamadı. Entegrasyon testleri gerçek bir veritabanı ister.\n' +
        '.env.example dosyasını .env olarak kopyalayıp doldurun.',
    );
  }

  const testUrl = process.env.TEST_DATABASE_URL;

  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri çalıştırılamaz.\n\n' +
        'Testler ÜRETİM veritabanında çalıştırılmamalı: sahte kayıt yazıp\n' +
        'siliyorlar ve bu bir kez müşteri sitesini düşürdü.\n\n' +
        'Ayrı bir veritabanı açıp .env dosyasına TEST_DATABASE_URL olarak ekleyin,\n' +
        'sonra şemayı kurun (bkz. README → "Testler").',
    );
  }

  const uretimUrl = process.env.DATABASE_URL;

  if (uretimUrl && veritabaniAdi(testUrl) === veritabaniAdi(uretimUrl)) {
    throw new Error(
      `TEST_DATABASE_URL üretim veritabanını ("${veritabaniAdi(testUrl)}") gösteriyor.\n\n` +
        'Testler bu veritabanına yazmamalı. TEST_DATABASE_URL değerini AYRI bir\n' +
        'veritabanına çevirin.',
    );
  }

  // Uygulama kodu (db/client.ts → Prisma) DATABASE_URL okuyor. Testler
  // boyunca onu test veritabanına çeviriyoruz; üretim değeri bu noktadan
  // sonra süreç içinde hiç görünmüyor.
  process.env.DATABASE_URL = testUrl;
  process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL ?? testUrl;
  process.env[ISARET] = '1';
}
