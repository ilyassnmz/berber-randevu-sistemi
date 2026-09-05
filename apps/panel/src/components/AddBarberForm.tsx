import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { createBarber } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import type { BarberRole } from '../lib/types';

/** Şifre kuralı sunucudakiyle aynı (`createBarberSchema`). */
const MIN_SIFRE = 10;

/**
 * Yeni berber ekleme (yalnızca admin görür — SettingsPage bunu kontrol eder).
 *
 * ⚠️ Şifreyi YÖNETİCİ belirliyor; sistem rastgele üretip göstermiyor.
 *
 * Eski davranış rastgele bir şifre üretip ekranda BİR KEZ gösteriyordu.
 * Kullanımda çöktü: yönetici ekranı kapatınca şifre kayboluyor ve geri
 * getirmenin hiçbir yolu kalmıyordu. Canlıda yaşandı — eklenen berber panele
 * hiç giremedi, düzeltmek için sunucuya bağlanmak gerekti.
 *
 * Şifreyi yöneticinin yazması bunu kaynağında bitiriyor: kaybolacak bir sır
 * yok, çünkü şifreyi zaten o seçiyor ve berbere kendisi söylüyor.
 */
export function AddBarberForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [role, setRole] = useState<BarberRole>('staff');
  const [error, setError] = useState<string | null>(null);
  const [eklenen, setEklenen] = useState<{ name: string; email: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createBarber({ name: name.trim(), email: email.trim(), password, role }),
    onSuccess: (data) => {
      setEklenen({ name: data.barber.name, email: data.barber.email });
      setName('');
      setEmail('');
      setPassword('');
      setPasswordAgain('');
      setRole('staff');
      void queryClient.invalidateQueries({ queryKey: ['barbers'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Berber eklenemedi'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim()) {
      setError('Ad ve giriş adresi gerekli');
      return;
    }
    if (password.length < MIN_SIFRE) {
      setError(`Şifre en az ${MIN_SIFRE} karakter olmalı`);
      return;
    }
    // ⚠️ İkinci alan gösteriş değil: yazım hatası olan bir şifre, berberin
    // panele hiç girememesi demek — ve yönetici yanlış yazdığını ancak
    // berber denediğinde öğrenir.
    if (password !== passwordAgain) {
      setError('Şifreler birbirini tutmuyor');
      return;
    }

    mutation.mutate();
  }

  if (eklenen) {
    return (
      <div>
        <div className="notice notice-info" role="status">
          <Check size={17} aria-hidden />
          <span>
            <strong>{eklenen.name}</strong> eklendi. Panele{' '}
            <strong>{eklenen.email}</strong> ve az önce belirlediğiniz şifreyle
            girebilir. Şifreyi kendisine iletmeyi unutmayın — dilerse
            Ayarlar’dan değiştirebilir.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-block"
          style={{ marginTop: 12 }}
          onClick={() => setEklenen(null)}
        >
          Yeni berber ekle
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
        <span>Giriş adresi</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ornek@ozdede.com"
          autoComplete="off"
          required
        />
        {/* Sık karışan nokta: buraya yazılan adrese hiçbir zaman e-posta
            gönderilmiyor. Gerçek bir posta kutusu olması gerekmiyor. */}
        <span className="field-hint">
          Berberin panele girerken yazacağı adres. Gerçek bir e-posta kutusu
          olmak zorunda değil — sisteme mail gönderilmiyor.
        </span>
      </label>

      <label className="field">
        <span>Şifre</span>
        <input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={MIN_SIFRE}
          autoComplete="new-password"
          required
        />
        <span className="field-hint">
          En az {MIN_SIFRE} karakter. Berbere siz ileteceksiniz, o da isterse
          sonradan değiştirebilir.
        </span>
      </label>

      <label className="field">
        <span>Şifre (tekrar)</span>
        <input
          type="text"
          value={passwordAgain}
          onChange={(e) => setPasswordAgain(e.target.value)}
          autoComplete="new-password"
          required
        />
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
