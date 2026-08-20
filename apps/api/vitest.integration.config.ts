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
    /**
     * beforeAll/afterAll için de 30 saniye.
     *
     * Vitest'in kanca varsayılanı 10 saniye ve bu, uzaktaki bir veritabanına
     * (Neon) karşı fixture kurmak için dar. Gerçekten yaşandı: webhook
     * testinin beforeAll'u zaman aşımına uğradı, fixture oluşmadı, afterAll
     * da tanımsız fixture'a takılıp dosyayı komple düşürdü. Testlerde hata
     * yoktu — ağ o an yavaştı.
     *
     * 60 saniye çünkü webhook testi import'larını bilerek beforeAll İÇİNDE
     * yapıyor (env değişkenleri modüller yüklenmeden ayarlanmalı). Diğer
     * dosyalar dosya başında import ediyor ve o süre kancaya sayılmıyor.
     * Windows'ta app.ts'in dönüştürülüp yüklenmesi tek başına ~13 saniye.
     */
    hookTimeout: 60_000,
  },
});
