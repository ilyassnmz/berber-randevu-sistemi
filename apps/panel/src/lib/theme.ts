export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ozdede-theme';
const THEME_COLOR: Record<Theme, string> = { light: '#f7f6f2', dark: '#0f0f17' };

/** localStorage'da yoksa varsayılan açık tema. */
export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

/** `<html data-theme>` ve durum çubuğu rengini uygular; index.html'deki
 * flaş-önleyici betikle aynı mantığı paylaşır. */
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
