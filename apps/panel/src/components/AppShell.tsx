import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useAuthStore } from '../lib/authStore';
import { logout as logoutRequest } from '../lib/endpoints';
import { getStoredTheme, toggleTheme, type Theme } from '../lib/theme';

/** Üst çubuk + içerik alanı. Tüm korumalı sayfalar bunun içinde render edilir. */
export function AppShell() {
  const barber = useAuthStore((s) => s.barber);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logoutRequest();
    } catch {
      // Sunucu tarafı başarısız olsa bile istemci oturumunu kapatıyoruz
    } finally {
      clearSession();
    }
  }

  function handleToggleTheme() {
    setTheme(toggleTheme());
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-title">
          <img src="/icons/icon-192.png" alt="" width={28} height={28} />
          Özdede Hair Studio
        </div>
        <div className="app-header-user">
          <span>{barber?.name}</span>
          <button
            className="btn-icon"
            onClick={handleToggleTheme}
            aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
            title={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            className="btn-icon"
            onClick={handleLogout}
            disabled={loggingOut}
            aria-label="Çıkış yap"
            title="Çıkış yap"
          >
            {loggingOut ? <span className="spinner" /> : '⏻'}
          </button>
        </div>
      </header>

      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
