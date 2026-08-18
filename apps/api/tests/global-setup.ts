import { PrismaClient } from '@prisma/client';
import { testVeritabaninaYonlendir } from './db-env.js';

/**
 * Test koşusu başlamadan ÖNCE bir kez çalışır.
 *
 * ── Neden var? ────────────────────────────────────────────────────
 *
 * Geliştirme ve üretim şu an AYNI veritabanını paylaşıyor. Her test koşusu
 * oraya geçici bir "test dükkanı" yazıyor ve sonunda siliyor. Koşu yarıda
 * kesilirse (Ctrl+C, çöken bir test, kapanan laptop) o dükkan ORADA KALIYOR.
 *
 * Bu gerçekten yaşandı ve müşteri sitesini düşürdü: site "hangi dükkana
 * aitim?" sorusuna iki aktif dükkan görünce cevap veremeyip hata döndü.
 * Ziyaretçiler "randevu sistemine ulaşılamıyor" ekranı gördü.
 *
 * İki savunma var, bu ikincisi:
 *   1. Sunucudaki PUBLIC_SHOP_ID — site artık hangi dükkan olduğunu kesin
 *      biliyor, kaç tane aktif dükkan olduğu onu ilgilendirmiyor. (Asıl koruma.)
 *   2. Buradaki süpürme — artıkların birikmesini önlüyor, yani her koşu
 *      kendinden öncekinin çöpünü topluyor.
 *
 * ⚠️ Yalnızca `test-` ile başlayan slug'ları siler. Gerçek dükkanın slug'ı
 * `ozdede-hair-studio`; asla eşleşmez. Test dükkanı adlandırması
 * `helpers.ts` → createFixture içinde belirleniyor, ikisi birlikte değişmeli.
 */
export async function setup(): Promise<void> {
  // Üretim koruması ve test veritabanına yönlendirme burada da gerekli:
  // globalSetup, setupFiles'dan ÖNCE ve ayrı bir modül grafiğinde çalışıyor.
  testVeritabaninaYonlendir();

  const prisma = new PrismaClient();

  try {
    const artiklar = await prisma.shop.findMany({
      where: { slug: { startsWith: 'test-' } },
      select: { id: true, name: true },
    });

    if (artiklar.length === 0) return;

    for (const shop of artiklar) {
      // Yabancı anahtar sırası destroyFixture ile aynı olmalı.
      await prisma.appointment.deleteMany({ where: { shopId: shop.id } });
      await prisma.refreshToken.deleteMany({ where: { barber: { shopId: shop.id } } });
      await prisma.shop.delete({ where: { id: shop.id } }).catch(() => {
        // Cascade zaten temizlemiş olabilir.
      });
    }

    console.warn(
      `[test] Önceki koşulardan kalan ${artiklar.length} test dükkanı temizlendi: ` +
        artiklar.map((s) => s.name).join(', '),
    );
  } finally {
    await prisma.$disconnect();
  }
}
