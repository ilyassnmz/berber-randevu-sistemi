import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { fetchServices, updateService, createService } from '../lib/endpoints';
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

  // Yeni hizmet formu
  const [yeniAd, setYeniAd] = useState('');
  const [yeniSure, setYeniSure] = useState('45');
  const [yeniFiyat, setYeniFiyat] = useState('');
  const [eklendi, setEklendi] = useState(false);

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

  const ekleMutation = useMutation({
    mutationFn: () =>
      createService({
        name: yeniAd.trim(),
        durationMin: Number(yeniSure),
        // Boş fiyat = "belirtilmemiş" (null), 0 ile karıştırılmamalı.
        price: yeniFiyat.trim() === '' ? null : Number(yeniFiyat),
      }),
    onSuccess: () => {
      setYeniAd('');
      setYeniSure('45');
      setYeniFiyat('');
      setEklendi(true);
      setTimeout(() => setEklendi(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ['services'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Hizmet eklenemedi'),
  });

  function handleEkle(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (yeniAd.trim().length < 2) {
      setError('Hizmet adı en az 2 karakter olmalı');
      return;
    }

    const sure = Number(yeniSure);
    if (!Number.isFinite(sure) || sure < 5) {
      setError('Süre en az 5 dakika olmalı');
      return;
    }

    ekleMutation.mutate();
  }

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

      <form className="service-add" onSubmit={handleEkle}>
        <h3 className="service-add-title">
          <Plus size={15} aria-hidden /> Yeni hizmet ekle
        </h3>
        <p className="service-add-hint">
          Eklediğiniz hizmet müşteri sitesinde anında görünür.
        </p>

        <label className="field">
          <span>Hizmet adı</span>
          <input
            type="text"
            value={yeniAd}
            onChange={(e) => setYeniAd(e.target.value)}
            placeholder="Örn: Kaş Alma"
            maxLength={80}
          />
        </label>

        <div className="service-add-row">
          <label className="field">
            <span>Süre (dk)</span>
            <input
              type="number"
              inputMode="numeric"
              value={yeniSure}
              onChange={(e) => setYeniSure(e.target.value)}
              min={5}
              max={480}
            />
          </label>
          <label className="field">
            <span>Fiyat (₺)</span>
            <input
              type="number"
              inputMode="decimal"
              value={yeniFiyat}
              onChange={(e) => setYeniFiyat(e.target.value)}
              placeholder="Örn: 100"
              min={0}
            />
          </label>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={ekleMutation.isPending}
        >
          {ekleMutation.isPending ? (
            <span className="spinner" />
          ) : eklendi ? (
            <>
              <Check size={16} aria-hidden /> Eklendi
            </>
          ) : (
            'Hizmeti Ekle'
          )}
        </button>
      </form>
      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
