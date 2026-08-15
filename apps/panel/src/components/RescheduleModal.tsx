import { useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Appointment } from '../lib/types';
import { fetchSlots, rescheduleAppointment } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import { addDaysToDate, formatDateTr, todayLocalDate, isToday } from '../lib/dates';

interface Props {
  appointment: Appointment;
  /** Vazgeçildi — randevu detayına geri dön. */
  onClose: () => void;
  /** Saat başarıyla değiştirildi — üstteki randevu detayı da kapanmalı. */
  onRescheduled: () => void;
}

/**
 * Randevu erteleme — backend (`rescheduleAppointment`) uzun süredir hazırdı
 * ama panelde hiç arayüzü yoktu. Boş saat seçimi walk-in akışıyla aynı
 * bileşenleri (date-nav, slot-card) kullanıyor ki tutarlı görünsün.
 */
export function RescheduleModal({ appointment, onClose, onRescheduled }: Props) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayLocalDate());
  const [error, setError] = useState<string | null>(null);

  const slotsQuery = useQuery({
    queryKey: ['slots', appointment.barberId, appointment.serviceId, date],
    queryFn: () =>
      fetchSlots({ barberId: appointment.barberId, serviceId: appointment.serviceId, date }),
  });

  const mutation = useMutation({
    mutationFn: (startsAt: string) => rescheduleAppointment(appointment.id, startsAt),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      onRescheduled();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Saat değiştirilemedi');
    },
  });

  const slots = slotsQuery.data?.slots ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Saati Değiştir</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Kapat">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="date-nav">
          <button
            className="btn-icon"
            onClick={() => setDate(addDaysToDate(date, -1))}
            aria-label="Önceki gün"
          >
            <ChevronLeft size={20} aria-hidden />
          </button>
          <div className="date-nav-label">{formatDateTr(date)}</div>
          <button
            className="btn-icon"
            onClick={() => setDate(addDaysToDate(date, 1))}
            aria-label="Sonraki gün"
          >
            <ChevronRight size={20} aria-hidden />
          </button>
          {!isToday(date) && (
            <button
              className="btn btn-secondary date-nav-today"
              onClick={() => setDate(todayLocalDate())}
            >
              Bugün
            </button>
          )}
        </div>

        {error && (
          <div className="form-error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        {slotsQuery.isLoading && (
          <div className="loading-center">
            <div className="spinner" />
          </div>
        )}

        {!slotsQuery.isLoading && slots.length === 0 && (
          <div className="state-message">Bu tarihte uygun saat yok.</div>
        )}

        <div className="appointment-list" style={{ marginTop: 12 }}>
          {slots.map((s) => (
            <button
              key={s.startsAt}
              className="slot-card"
              onClick={() => {
                setError(null);
                mutation.mutate(s.startsAt);
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <span className="spinner" /> : `${s.label} · Bu saate taşı`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
