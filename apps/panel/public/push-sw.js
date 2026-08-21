/**
 * Bildirim dinleyicileri.
 *
 * ⚠️ Bu dosya service worker'ın KENDİSİ DEĞİL. vite-plugin-pwa üretilen
 * service worker'a bunu `importScripts` ile ekliyor (vite.config.ts →
 * workbox.importScripts).
 *
 * Neden böyle: PWA'nın tüm service worker'ını elle yazmaya geçmek
 * (injectManifest) çevrimdışı önbellekleme mantığını da devralmak demekti.
 * Çalışan bir şeyi bildirim eklemek için baştan yazmanın anlamı yok.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let veri;
  try {
    veri = event.data.json();
  } catch {
    // Beklenmeyen biçim — bildirimi düşürmektense ham metni göster.
    veri = { title: 'Özdede Panel', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(veri.title ?? 'Yeni randevu', {
      body: veri.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Aynı etiketli bildirimler üst üste yığılmaz, sonuncusu görünür.
      // Arka arkaya üç randevu gelirse berber üç ayrı bildirimle
      // boğulmasın diye DEĞİL — her randevu ayrı görünmeli, o yüzden
      // etiket randevuya özgü tutuluyor.
      tag: veri.tag ?? undefined,
      data: { url: veri.url ?? '/' },
      // Titreşim: berber tıraş ortasında telefona bakmıyor olabilir.
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hedef = event.notification.data?.url ?? '/';

  event.waitUntil(
    (async () => {
      const pencereler = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Panel zaten açıksa yeni sekme AÇMA — o pencereyi öne getir.
      // Aksi halde berberin telefonu her bildirimde yeni bir panel
      // sekmesiyle dolardı.
      for (const pencere of pencereler) {
        if (pencere.url.includes(self.location.origin)) {
          await pencere.focus();
          if ('navigate' in pencere) await pencere.navigate(hedef);
          return;
        }
      }

      await self.clients.openWindow(hedef);
    })(),
  );
});
