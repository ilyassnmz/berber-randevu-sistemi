import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './routes/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import CalendarPage from './pages/CalendarPage';
import { AppShell } from './components/AppShell';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/giris" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<CalendarPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
