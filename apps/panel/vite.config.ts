import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Özdede Hair Studio Panel',
          short_name: 'Özdede Panel',
          description: 'Randevu yönetim paneli',
          theme_color: '#151521',
          background_color: '#151521',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          lang: 'tr',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Bildirim dinleyicileri üretilen service worker'a eklenir.
          // Tüm SW'u elle yazmaya geçmek (injectManifest) yerine bu:
          // çalışan çevrimdışı önbellekleme mantığı olduğu gibi kalıyor.
          importScripts: ['push-sw.js'],
          // API isteklerini önbelleğe alma — randevu verisi her zaman taze olmalı.
          // Yalnızca uygulama kabuğu (JS/CSS/HTML) çevrimdışı çalışsın.
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^\/api\//,
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
