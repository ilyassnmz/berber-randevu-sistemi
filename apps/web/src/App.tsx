import { Routes, Route, Navigate } from 'react-router-dom';
import BookingPage from './pages/BookingPage';
import AppointmentPage from './pages/AppointmentPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BookingPage />} />
      {/* Randevu bağlantısı. Anahtar tahmin edilemez olduğu için bu adres
          tek başına randevuyu görüntüleme ve iptal etme yetkisi taşır. */}
      <Route path="/randevu/:token" element={<AppointmentPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
