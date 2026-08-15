import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './routes/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import CalendarPage from './pages/CalendarPage';
import SettingsPage from './pages/SettingsPage';
import CustomersPage from './pages/CustomersPage';
import StatsPage from './pages/StatsPage';
import { AppShell } from './components/AppShell';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/giris" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<CalendarPage />} />
            <Route path="/musteriler" element={<CustomersPage />} />
            <Route path="/istatistik" element={<StatsPage />} />
            <Route path="/ayarlar" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
