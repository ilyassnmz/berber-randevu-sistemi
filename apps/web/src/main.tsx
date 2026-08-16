import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import './styles/theme.css';
import './styles/booking.css';
import App from './App';

/**
 * ⚠️ `refetchOnWindowFocus` kapalı.
 *
 * Müşteri randevu formunu doldururken başka bir uygulamaya geçip (ör. telefon
 * numarasını kopyalamak için) geri dönebiliyor. Açık bırakılsaydı, geri
 * döndüğü anda slot listesi yeniden çekilir ve seçili saat listeden düşerse
 * seçimi ayağının altından kayardı.
 *
 * Bu, saatin dolmasına karşı bir risk yaratmıyor: randevu oluştururken sunucu
 * müsaitliği zaten yeniden doğruluyor ve gerçek güvence veritabanındaki
 * çakışma kısıtı.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
