import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTimeOff, createTimeOff, deleteTimeOff } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import { formatDateTr, localDayRangeIso, todayLocalDate } from '../lib/dates';

interface Props {
  barberId: string;
}

/**
 * İzin/kapalı gün yönetimi. Fırat'ın istediği "bugün randevu alma" özelliği
 * burada: bir gün seçip "Bu Günü Kapat"a basmak o günün tamamını
 * `time_off` olarak işaretliyor — slot motoru zaten bu tabloyu okuyor
 * (services/slots.ts), yeni bir kural eklenmedi, sadece yazma arayüzü.
 */
export function TimeOffManager({ barberId }: Props) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayLocalDate());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['time-off', barberId],
    queryFn: () => fetchTimeOff(barberId),
  });

  const createMutation = useMutation({
    mutationFn: () => createTimeOff(barberId, { ...localDayRangeIso(date), reason: reason.trim() || 'İzinli' }),
    onSuccess: () => {
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['time-off', barberId] });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İzin eklenemedi'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTimeOff(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['time-off', barberId] });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İzin silinemedi'),
  });

  const timeOff = query.data?.timeOff ?? [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: '1 1 140px' }}>
          <span>Tarih</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={todayLocalDate()} />
        </label>
        <label className="field" style={{ flex: '2 1 200px' }}>
          <span>Sebep (opsiyonel)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="İzinli"
            maxLength={200}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setError(null);
            createMutation.mutate();
          }}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? <span className="spinner" /> : 'Bu Günü Kapat'}
        </button>
      </div>

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {query.isLoading && (
          <div className="loading-center">
            <div className="spinner" />
          </div>
        )}

        {!query.isLoading && timeOff.length === 0 && (
          <p className="settings-section-hint">Planlanmış izin günü yok.</p>
        )}

        {timeOff.map((t) => (
          <div className="time-off-item" key={t.id}>
            <div className="time-off-item-info">
              <div className="time-off-item-date">{formatDateTr(t.startsAt.slice(0, 10))}</div>
              <div className="time-off-item-reason">{t.reason}</div>
            </div>
            <button
              type="button"
              className="btn-icon"
              aria-label="İzni kaldır"
              onClick={() => deleteMutation.mutate(t.id)}
              disabled={deleteMutation.isPending}
            >
              🗑️
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
