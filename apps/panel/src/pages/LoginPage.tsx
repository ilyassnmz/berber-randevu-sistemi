import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { login } from '../lib/endpoints';
import { ApiError } from '../lib/api';

export default function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await login(email.trim(), password);
      setSession(result.accessToken, result.barber);
    } catch (err) {
      if (err instanceof ApiError) {
        // Hesap kilitli mesajı özel olarak dönüyor (403); diğer her şey
        // "e-posta veya şifre hatalı" gibi tek tip görünsün istiyoruz —
        // backend zaten aynı mesajı veriyor, burada olduğu gibi gösteriyoruz.
        setError(err.message);
      } else {
        setError('Bağlantı hatası. Lütfen tekrar deneyin.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo" aria-hidden>
          💈
        </div>
        <h1>Müslüm Berber</h1>
        <p className="login-subtitle">Randevu Paneli</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>E-posta</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span>Şifre</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? <span className="spinner" /> : 'Giriş Yap'}
          </button>
        </form>
      </div>
    </div>
  );
}
