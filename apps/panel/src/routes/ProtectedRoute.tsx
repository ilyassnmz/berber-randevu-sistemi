import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { bootstrapAuth } from '../lib/api';

/**
 * Uygulama ilk açıldığında `bootstrapAuth` bir kez çağrılır: httpOnly
 * çerez geçerliyse sessizce oturum kurulur, sayfa yenilenince kullanıcı
 * tekrar giriş yapmak zorunda kalmaz.
 */
export function ProtectedRoute() {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status === 'loading') void bootstrapAuth();
  }, [status]);

  if (status === 'loading') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/giris" replace />;
  }

  return <Outlet />;
}
