import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/theme.css';
import './styles/layout.css';

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
