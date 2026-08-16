/**
 * ══════════════════════════════════════════════════════════════════
 *  KENDİNİ İMHA EDEN SERVICE WORKER
 * ══════════════════════════════════════════════════════════════════
 *
 * Bu dosya bir özellik değil, bir TEMİZLİK aracı. Yeni bir şey yapmıyor;
 * eskiden kalmış bir şeyi kaldırıyor.
 *
 * ── Neden var? ────────────────────────────────────────────────────
 *
 * `ozdedehairstudio.com` eskiden berber PANELİNİ sunuyordu ve panel bir
 * PWA — yani bu adrese giren herkesin tarayıcısına bir service worker
 * kaydedildi. O service worker sayfayı kendi önbelleğinden sunuyor.
 *
 * Kök adres artık müşteri randevu sitesini sunuyor, ama daha önce siteyi
 * açmış olan tarayıcılarda o eski service worker HÂLÂ KAYITLI ve eski
 * paneli göstermeye devam ediyor. Sunucudaki değişiklik onları hiç
 * etkilemiyor.
 *
 * Service worker'ı kaldırmanın tek yolu, tarayıcıya AYNI ADRESTE yeni bir
 * service worker vermek. Tarayıcı güncelleme kontrolünde bu dosyayı indirip
 * kuruyor, bu dosya da tüm önbelleği silip kendini siliyor ve açık sekmeleri
 * yeniliyor. Sonrasında adres tamamen normal bir web sitesi gibi çalışıyor.
 *
 * ⚠️ Bu dosya SİLİNMEMELİ. Silinirse, o eski service worker'ı hâlâ taşıyan
 * (aylardır siteye girmemiş) bir tarayıcı geri döndüğünde yine eski paneli
 * görür. Yıllarca burada durması zararsız — sadece birkaç satır.
 *
 * `fetch` dinleyicisi BİLEREK yok: dinleyici eklenseydi bu service worker
 * ağ isteklerini araya girerek karşılamaya devam ederdi. Dinleyici olmayınca
 * tarayıcı tüm istekleri doğrudan ağa gönderiyor.
 */

self.addEventListener('install', () => {
  // Bekleme sırasına girme, hemen devral — temizlik gecikmesin.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Eski panelin önbelleğe aldığı her şeyi sil.
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      // 2. Kendini kayıttan düşür.
      await self.registration.unregister();

      // 3. Açık sekmeleri yenile — yoksa kullanıcı sayfayı elle
      //    yenileyene kadar hâlâ eski paneli görmeye devam eder.
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) {
        client.navigate(client.url);
      }
    })(),
  );
});
