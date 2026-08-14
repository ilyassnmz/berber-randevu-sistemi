import { useState, type FormEvent, type FocusEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isValidPhone } from '@berber/shared';
import type { Service } from '../lib/types';
import { createAppointment } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import { formatDateTr, formatTimeTr } from '../lib/dates';

interface Props {
  barberId: string;
  barberName: string;
  startsAt: string;
  date: string;
  services: Service[];
  onClose: () => void;
}

/**
 * Kapıdan gelen müşteri için randevu formu.
 *
 * v1 dokümanında yoktu ama berberin en sık kullanacağı özellik bu —
 * kapıdan gelen müşteri sisteme girilemezse takvim gerçekle uyuşmaz.
 * Telefon opsiyonel: müşteri numarasını vermek zorunda değil.
 */
export function WalkInModal({ barberId, barberName, startsAt, date, services, onClose }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  function handlePhoneBlur(e: FocusEvent<HTMLInputElement>) {
    const value = e.target.value.trim();
    setPhoneError(value && !isValidPhone(value) ? 'Geçerli bir telefon numarası girin' : null);
  }

  const mutation = useMutation({
    mutationFn: () =>
      createAppointment({
        barberId,
        serviceId,
        startsAt,
        customerName: name.trim(),
        ...(phone.trim() ? { customerPhone: phone.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Randevu oluşturulamadı');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Müşteri adı gerekli');
      return;
    }
    if (!serviceId) {
      setError('Hizmet seçin');
      return;
    }
    if (phone.trim() && !isValidPhone(phone.trim())) {
      setError('Geçerli bir telefon numarası girin');
      return;
    }

    mutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Yeni Randevu</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>

        <p className="appt-meta" style={{ marginBottom: 16 }}>
          {barberName} · {formatDateTr(date)} · {formatTimeTr(startsAt)}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label className="field">
            <span>Müşteri adı *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </label>

          <label className="field">
            <span>Telefon (opsiyonel)</span>
            <input
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError(null);
              }}
              onBlur={handlePhoneBlur}
              placeholder="0532 123 45 67"
              inputMode="tel"
              aria-invalid={phoneError ? true : undefined}
            />
            {phoneError && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{phoneError}</span>}
          </label>

          <label className="field">
            <span>Hizmet *</span>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <div className="modal-actions-row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Vazgeç
            </button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? <span className="spinner" /> : 'Randevu Oluştur'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
