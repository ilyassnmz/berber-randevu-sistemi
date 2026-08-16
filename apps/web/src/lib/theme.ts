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
 * Kayıtlı tema; yoksa CİHAZIN tercihi.
 *
 * Panelden tek farkı bu: panel varsayılan olarak açık temaya düşüyor, burada
 * ilk ziyarette cihazın koyu tema tercihi varsa ona uyuluyor. Müşteri bu
 * sayfaya yılda birkaç kez giriyor; "ilk açılışta doğru görünsün" beklentisi
 * berberin her gün açtığı panele göre daha baskın.
 */
export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
