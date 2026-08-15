import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePassword } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import { useAuthStore } from '../lib/authStore';

interface Props {
  onClose: () => void;
}

/**
 * Şifre değiştirme.
 *
 * Backend (`POST /auth/change-password`) uzun süredir hazırdı ve test
 * ediliyordu — panelde bunu çağıran bir ekran yoktu.
 *
 * ⚠️ Backend, şifre değişince TÜM oturumları (bu cihaz dahil) kapatıyor —
 * bilinçli bir güvenlik kararı. Bu yüzden başarılı olunca kullanıcı
 * otomatik olarak çıkışa düşürülüp tekrar giriş yapması isteniyor.
 */
export function ChangePasswordModal({ onClose }: Props) {
  const clearSession = useAuthStore((s) => s.clearSession);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordAgain, setNewPasswordAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setDone(true);
      setTimeout(() => clearSession(), 1800);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Şifre değiştirilemedi');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 10) {
      setError('Yeni şifre en az 10 karakter olmalı');
      return;
    }
    if (newPassword !== newPasswordAgain) {
      setError('Yeni şifreler eşleşmiyor');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Yeni şifre mevcut şifreyle aynı olamaz');
      return;
    }

    mutation.mutate();
  }

  if (done) {
    return (
      <div className="modal-overlay">
        <div className="modal-sheet">
          <div className="modal-header">
            <h2>Şifreniz değiştirildi</h2>
          </div>
          <p className="appt-meta">Güvenlik gereği tüm cihazlarda oturum kapatıldı. Yeni şifrenizle tekrar giriş yapın…</p>
          <div className="loading-center">
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Şifre Değiştir</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label className="field">
            <span>Mevcut şifre</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </label>

          <label className="field">
            <span>Yeni şifre (en az 10 karakter)</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </label>

          <label className="field">
            <span>Yeni şifre (tekrar)</span>
            <input
              type="password"
              value={newPasswordAgain}
              onChange={(e) => setNewPasswordAgain(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </label>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="modal-actions-row">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
              Vazgeç
            </button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? <span className="spinner" /> : 'Şifreyi Değiştir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
