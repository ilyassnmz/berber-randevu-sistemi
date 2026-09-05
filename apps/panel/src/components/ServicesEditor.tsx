import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { fetchServices, updateService, createService, deleteService } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import type { Service } from '../lib/types';

/**
 * Hizmet süresi ve fiyatı düzenleme (yalnızca admin).
 *
 * `services.price` ve `services.duration_min` kolonları baştan beri vardı —
 * slot motoru süreyi zaten okuyordu — ama ikisini de değiştirecek bir arayüz
 * yoktu, fiyatlar da boştu. "Boyama 90 dakika" demek artık tek bir düzenleme.
 */
interface ServiceDraft {
  name: string;
  durationMin: string;
  price: string;
  /** "Ayrı zaman ister" — bkz. @berber/shared → duration.ts. */
  requiresOwnSlot: boolean;
}

export function ServicesEditor() {
  const queryClient = useQueryClient();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ServiceDraft>>({});

  // Yeni hizmet formu
  const [yeniAd, setYeniAd] = useState('');
  const [yeniSure, setYeniSure] = useState('45');
  const [yeniFiyat, setYeniFiyat] = useState('');
  const [yeniAyriZaman, setYeniAyriZaman] = useState(false);
  const [eklendi, setEklendi] = useState(false);

  // Silme onayı bekleyen hizmet. Tek tıkla silinmemeli — geri alınamaz.
  const [silinecek, setSilinecek] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['services'], queryFn: fetchServices });
  const services = query.data?.services ?? [];

  function draftFor(s: Service): ServiceDraft {
    return (
      drafts[s.id] ?? {
        name: s.name,
        durationMin: String(s.durationMin),
        price: s.price ?? '',
        requiresOwnSlot: s.requiresOwnSlot ?? false,
      }
    );
  }

  function setDraft(id: string, patch: Partial<ServiceDraft>) {
    const service = services.find((s) => s.id === id);
    const current = drafts[id] ?? {
      name: service?.name ?? '',
      durationMin: String(service?.durationMin ?? 45),
      price: service?.price ?? '',
      requiresOwnSlot: service?.requiresOwnSlot ?? false,
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
        name: draft.name.trim(),
        durationMin: duration,
        price,
        requiresOwnSlot: draft.requiresOwnSlot,
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
        requiresOwnSlot: yeniAyriZaman,
      }),
    onSuccess: () => {
      setYeniAd('');
      setYeniSure('45');
      setYeniFiyat('');
      setYeniAyriZaman(false);
      setEklendi(true);
      setTimeout(() => setEklendi(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ['services'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Hizmet eklenemedi'),
  });

  const silMutation = useMutation({
    mutationFn: (id: string) => deleteService(id),
    onSuccess: (sonuc) => {
      setSilinecek(null);
      // Kullanıcıya NE olduğunu söylüyoruz: silindi mi, gizlendi mi?
      // "Sildim" deyip aslında gizlemek, berber geçmiş randevuda o hizmeti
      // görünce kafa karışıklığı yaratırdı.
      setBilgi(
        sonuc.mode === 'deleted'
          ? 'Hizmet silindi.'
          : `Hizmet gizlendi. ${sonuc.appointmentCount} randevuda kullanıldığı için ` +
            'tamamen silinemez; geçmiş randevularda adı görünmeye devam eder.',
      );
      setTimeout(() => setBilgi(null), 6000);
      void queryClient.invalidateQueries({ queryKey: ['services'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Hizmet kaldırılamadı'),
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
            <label className="service-row-field service-row-name-field">
              <span>Hizmet adı</span>
              <input
                type="text"
                value={draft.name}
                maxLength={80}
                onChange={(e) => setDraft(s.id, { name: e.target.value })}
              />
            </label>
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
            <button
              type="button"
              className="btn-icon service-row-delete"
              aria-label={`${s.name} hizmetini kaldır`}
              onClick={() => {
                setError(null);
                setSilinecek(silinecek === s.id ? null : s.id);
              }}
              disabled={silMutation.isPending}
            >
              <Trash2 size={16} aria-hidden />
            </button>

            {/*
              "Ayrı zaman ister" — çoklu hizmet seçiminin süreyi nasıl
              etkilediğini belirleyen tek ayar.

              Müşteri birden fazla hizmet seçtiğinde süreler TOPLANMIYOR:
              saç ile ağda aynı 45 dakikada yapılıyor. Bu kutu işaretli
              hizmetler istisna — yanlarında başka hizmet varken randevuya
              kendi sürelerini ekliyorlar (Lazer).
            */}
            <label className="service-row-flag">
              <input
                type="checkbox"
                checked={draft.requiresOwnSlot}
                onChange={(e) => setDraft(s.id, { requiresOwnSlot: e.target.checked })}
              />
              <span>
                Ayrı zaman ister
                <small>Başka bir hizmetle birlikte seçilirse randevu uzar</small>
              </span>
            </label>

            {silinecek === s.id && (
              <div className="service-confirm">
                <span>
                  <strong>{s.name}</strong> kaldırılsın mı? Müşteriler bu hizmeti
                  artık göremeyecek.
                </span>
                <div className="service-confirm-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSilinecek(null)}
                    disabled={silMutation.isPending}
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => silMutation.mutate(s.id)}
                    disabled={silMutation.isPending}
                  >
                    {silMutation.isPending ? <span className="spinner" /> : 'Evet, kaldır'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {bilgi && (
        <div className="notice notice-info service-notice" role="status">
          {bilgi}
        </div>
      )}

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

        <label className="service-row-flag">
          <input
            type="checkbox"
            checked={yeniAyriZaman}
            onChange={(e) => setYeniAyriZaman(e.target.checked)}
          />
          <span>
            Ayrı zaman ister
            <small>Başka bir hizmetle birlikte seçilirse randevu uzar</small>
          </span>
        </label>

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
