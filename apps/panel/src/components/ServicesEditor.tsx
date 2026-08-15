import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { fetchServices, updateService } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import type { Service } from '../lib/types';

/**
 * Hizmet süresi ve fiyatı düzenleme (yalnızca admin).
 *
 * `services.price` ve `services.duration_min` kolonları baştan beri vardı —
 * slot motoru süreyi zaten okuyordu — ama ikisini de değiştirecek bir arayüz
 * yoktu, fiyatlar da boştu. "Boyama 90 dakika" demek artık tek bir düzenleme.
 */
export function ServicesEditor() {
  const queryClient = useQueryClient();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { durationMin: string; price: string }>>({});

  const query = useQuery({ queryKey: ['services'], queryFn: fetchServices });
  const services = query.data?.services ?? [];

  function draftFor(s: Service) {
    return (
      drafts[s.id] ?? {
        durationMin: String(s.durationMin),
        price: s.price ?? '',
      }
    );
  }

  function setDraft(id: string, patch: Partial<{ durationMin: string; price: string }>) {
    const current = drafts[id] ?? {
      durationMin: String(services.find((s) => s.id === id)?.durationMin ?? 45),
      price: services.find((s) => s.id === id)?.price ?? '',
    };
    setDrafts({ ...drafts, [id]: { ...current, ...patch } });
  }

  const mutation = useMutation({
    mutationFn: (service: Service) => {
      const draft = draftFor(service);
      const duration = Number(draft.durationMin);
      // Boş fiyat = "fiyat belirtilmemiş" (null), 0 ile karıştırılmamalı.
      const price = draft.price.trim() === '' ? null : Number(draft.price);
      return updateService(service.id, {
        name: service.name,
        durationMin: duration,
        price,
      });
    },
    onSuccess: (_data, service) => {
      setSavedId(service.id);
      setTimeout(() => setSavedId(null), 2000);
      void queryClient.invalidateQueries({ queryKey: ['services'] });
      // Süre değişmiş olabilir — slot ızgarası yeniden hesaplanmalı.
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Kaydedilemedi'),
  });

  if (query.isLoading) {
    return (
      <div className="loading-center">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div>
      {services.map((s) => {
        const draft = draftFor(s);
        return (
          <div className="service-row" key={s.id}>
            <span className="service-row-name">{s.name}</span>
            <label className="service-row-field">
              <span>Süre (dk)</span>
              <input
                type="number"
                inputMode="numeric"
                min={5}
                max={480}
                value={draft.durationMin}
                onChange={(e) => setDraft(s.id, { durationMin: e.target.value })}
              />
            </label>
            <label className="service-row-field">
              <span>Fiyat (₺)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                placeholder="—"
                value={draft.price}
                onChange={(e) => setDraft(s.id, { price: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary service-row-save"
              onClick={() => {
                setError(null);
                mutation.mutate(s);
              }}
              disabled={mutation.isPending}
            >
              {savedId === s.id ? <Check size={16} aria-hidden /> : 'Kaydet'}
            </button>
          </div>
        );
      })}

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
