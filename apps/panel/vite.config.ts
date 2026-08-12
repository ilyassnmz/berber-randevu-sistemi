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
        includeAssets: ['icons/icon-192.svg', 'icons/icon-512.svg'],
        manifest: {
          name: 'Müslüm Berber Panel',
          short_name: 'Berber Panel',
          description: 'Randevu yönetim paneli',
          theme_color: '#151521',
          background_color: '#151521',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          lang: 'tr',
          icons: [
            { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'maskable' },
            { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
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
