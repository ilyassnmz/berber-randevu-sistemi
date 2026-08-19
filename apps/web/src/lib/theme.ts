/**
 * Tema yönetimi — panelle AYNI mantık (apps/panel/src/lib/theme.ts).
 *
 * Bilerek birebir aynı: iki uygulama aynı `data-theme` sözleşmesini ve aynı
 * paleti kullanıyor. Biri değişirse diğeri de değişmeli, yoksa aynı dükkanın
 * iki yüzü farklı görünür.
 *
 * ⚠️ Depolama anahtarı panelden AYRI (`ozdede-web-theme`). İki uygulama
 * farklı alan adlarında çalışıyor (site kökte, panel alt alan adında), yani
 * localStorage zaten paylaşılmıyor — aynı anahtarı kullanmak paylaşılıyormuş
 * yanılsaması yaratırdı.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ozdede-web-theme';
const THEME_COLOR: Record<Theme, string> = { light: '#f7f6f2', dark: '#0f0f17' };

/**
 * Kayıtlı tema; yoksa AÇIK tema.
 *
 * ⚠️ Cihazın koyu tema tercihine BİLEREK uyulmuyor.
 *
 * Bu bir dükkanın vitrini: siteye ilk giren herkes aynı şeyi görmeli.
 * Cihaz tercihine uyulduğunda aynı adres kimine açık, kimine koyu açılıyordu
 * ve dükkanın nasıl göründüğü ziyaretçinin telefon ayarına kalıyordu.
 *
 * Koyu temayı isteyen sağ üstteki düğmeyle geçebiliyor ve tercihi
 * hatırlanıyor — yani seçim kaybolmuyor, sadece varsayılan sabitleniyor.
 */
export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;

  return 'light';
}

/**
 * `<html data-theme>` ve tarayıcı durum çubuğu rengini uygular.
 * index.html'deki flaş önleyici betikle aynı mantığı paylaşır.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme]);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function toggleTheme(): Theme {
  const next: Theme = getStoredTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
