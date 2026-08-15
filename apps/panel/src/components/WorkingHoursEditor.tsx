import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWorkingHours, updateWorkingHours } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import type { WorkingHoursDay } from '../lib/types';

const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

interface Props {
  barberId: string;
}

/**
 * Haftalık çalışma programı — Müslüm ve Fırat'ın kendi (ya da admin için
 * herhangi bir berberin) saatlerini/izin günlerini kolayca değiştirebileceği
 * ekran. `working_hours` tablosu şemada baştan beri vardı, bunu düzenleyen
 * bir arayüz hiç yoktu.
 */
export function WorkingHoursEditor({ barberId }: Props) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<WorkingHoursDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const query = useQuery({
    queryKey: ['working-hours', barberId],
    queryFn: () => fetchWorkingHours(barberId),
  });

  useEffect(() => {
    if (query.data) {
      setDays([...query.data.workingHours].sort((a, b) => a.dayOfWeek - b.dayOfWeek));
      setSaved(false);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (input: WorkingHoursDay[]) => updateWorkingHours(barberId, input),
    onSuccess: (data) => {
      setDays([...data.workingHours].sort((a, b) => a.dayOfWeek - b.dayOfWeek));
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Kaydedilemedi'),
  });

  function updateDay(dayOfWeek: number, patch: Partial<WorkingHoursDay>) {
    setDays((prev) =>
      prev ? prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)) : prev,
    );
  }

  function handleSave() {
    if (!days) return;
    setError(null);
    mutation.mutate(days);
  }

  if (query.isLoading || !days) {
    return (
      <div className="loading-center">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div>
      {days.map((day) => (
        <div className="day-row" key={day.dayOfWeek}>
          <span className="day-row-name">{DAY_NAMES[day.dayOfWeek]}</span>
          <input
            type="time"
            value={day.startTime}
            disabled={!day.isWorking}
            onChange={(e) => updateDay(day.dayOfWeek, { startTime: e.target.value })}
          />
          <input
            type="time"
            value={day.endTime}
            disabled={!day.isWorking}
            onChange={(e) => updateDay(day.dayOfWeek, { endTime: e.target.value })}
          />
          <button
            type="button"
            className="day-toggle"
            data-on={day.isWorking}
            aria-label={day.isWorking ? 'Açık — kapatmak için dokunun' : 'Kapalı — açmak için dokunun'}
            onClick={() => updateDay(day.dayOfWeek, { isWorking: !day.isWorking })}
          />
        </div>
      ))}

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 16 }}
        onClick={handleSave}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? <span className="spinner" /> : saved ? '✅ Kaydedildi' : 'Kaydet'}
      </button>
    </div>
  );
}
