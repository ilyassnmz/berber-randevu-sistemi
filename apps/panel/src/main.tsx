import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles/theme.css';
import './styles/layout.css';

/**
 * Servis çalışanı (service worker) güncelleme kontrolü.
 *
 * Telefonda ana ekrana eklenmiş bir PWA oturumu günlerce kapatılmadan açık
 * kalabilir — tarayıcı service worker'ı yalnızca SAYFA YENİLENİNCE otomatik
 * kontrol eder. Bu olmadan berber, panelde bir düzeltme/güncelleme yapılmış
 * olsa bile haftalar önceki JS koduyla çalışmaya devam edebilir (ör. o anki
 * hatalı bir hesaplama hâlâ çalışıyor gibi görünür — "eski sürüm" sorunu).
 *
 * Her 30 dakikada bir ve uygulama ön plana her geldiğinde güncelleme
 * kontrolü tetikleyerek bunu önlüyoruz. `registerType: 'autoUpdate'`
 * (vite.config.ts) yeni sürüm bulununca kendiliğinden devreye alıyor.
 */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;

    setInterval(() => {
      void registration.update();
    }, UPDATE_CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void registration.update();
      }
    });
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Randevu verisi sık değişebilir (başka cihazdan işlem yapılabilir);
      // odak değişince ve yeniden bağlanınca tazelenmesi işe yarar.
      staleTime: 15_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
