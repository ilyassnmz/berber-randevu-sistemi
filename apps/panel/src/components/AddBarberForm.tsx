import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createBarber } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import type { BarberRole } from '../lib/types';

/**
 * Yeni berber ekleme (yalnızca admin görür — SettingsPage bunu kontrol eder).
 *
 * Şifre `seed.ts`/`reset-password.ts` ile aynı mantıkla üretilir ve BİR KEZ
 * gösterilir — argon2id geri alınamaz, bir daha görüntülenemez.
 */
export function AddBarberForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<BarberRole>('staff');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; email: string; password: string } | null>(
    null,
  );

  const mutation = useMutation({
    mutationFn: () => createBarber({ name: name.trim(), email: email.trim(), role }),
    onSuccess: (data) => {
      setResult({ name: data.barber.name, email: data.barber.email, password: data.password });
      setName('');
      setEmail('');
      setRole('staff');
      void queryClient.invalidateQueries({ queryKey: ['barbers'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Berber eklenemedi'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError('Ad ve e-posta gerekli');
      return;
    }
    mutation.mutate();
  }

  if (result) {
    return (
      <div>
        <div className="form-error" role="alert" style={{ background: 'var(--danger-bg)', marginBottom: 12 }}>
          ⚠️ Bu şifre bir daha gösterilmeyecek — hemen bir parola yöneticisine kaydedin.
        </div>
        <div className="detail-row">
          <span>Ad</span>
          <strong>{result.name}</strong>
        </div>
        <div className="detail-row">
          <span>E-posta</span>
          <strong>{result.email}</strong>
        </div>
        <div className="detail-row">
          <span>Şifre</span>
          <strong style={{ fontFamily: 'monospace' }}>{result.password}</strong>
        </div>
        <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 16 }} onClick={() => setResult(null)}>
          Kaydettim, kapat
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <label className="field">
        <span>Ad Soyad</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        <span>E-posta</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>Rol</span>
        <select value={role} onChange={(e) => setRole(e.target.value as BarberRole)}>
          <option value="staff">Çalışan</option>
          <option value="admin">Yönetici</option>
        </select>
      </label>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={mutation.isPending}>
        {mutation.isPending ? <span className="spinner" /> : 'Berber Ekle'}
      </button>
    </form>
  );
}
