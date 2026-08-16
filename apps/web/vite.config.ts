import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Herkese açık randevu sitesi.
 *
 * ⚠️ Panelden farklı olarak PWA YOK — bilinçli. Panel, berberlerin her gün
 * telefonunda açtığı bir uygulama; burası müşterinin yılda birkaç kez girip
 * randevu alıp çıktığı bir sayfa. Service worker eklemek, müşteriye hiçbir
 * fayda sağlamadan eski sürümün önbellekte takılı kalması riskini getirirdi
 * (panelde tam olarak bu sorun yaşandı).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      // Panel 5173'te; ikisi aynı anda çalışabilsin.
      port: 5174,
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
