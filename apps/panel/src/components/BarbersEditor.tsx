import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Power, PowerOff, Trash2 } from 'lucide-react';
import { fetchAllBarbers, updateBarber, deleteBarber } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import { useAuthStore } from '../lib/authStore';
import type { BarberAdmin, BarberRole } from '../lib/types';

/**
 * Berber düzenleme, kapatma ve kaldırma (yalnızca admin).
 *
 * ── İki ayrı düğme, iki ayrı niyet ───────────────────────────────
 *
 *   ⏻ Kapat/aç — berber şu an çalışmıyor (uzun izin, ayrılık). Kaydı durur,
 *     geri açılabilir.
 *   🗑 Kaldır  — bu kayıt hiç olmamalıydı (yanlış eklenmiş, deneme). Hiç
 *     randevusu yoksa GERÇEKTEN silinir; varsa sunucu kapatmaya düşer ve
 *     hangisini yaptığını söyler.
 *
 * İkincisi sonradan eklendi: ilk sürümde her berber yalnızca "kapatılıyordu",
 * dolayısıyla deneme amaçlı açılan bir kayıt yönetim listesinden hiç
 * kaybolmuyordu ve kullanıcı haklı olarak "silemiyorum" dedi.
 *
 * Kurallar sunucuda (services/barbers.ts): son yönetici kaldırılamaz, kendi
 * hesabını kaldıramazsın, gelecek randevusu olan berber ne kapatılır ne
 * silinir. Bu ekran o hataları olduğu gibi gösteriyor — kuralları burada
 * tekrarlamak, iki tarafın zamanla ayrışması demek olurdu.
 */
interface BarberDraft {
  name: string;
  role: BarberRole;
}

export function BarbersEditor() {
  const queryClient = useQueryClient();
  const oturumdaki = useAuthStore((s) => s.barber);

  const [drafts, setDrafts] = useState<Record<string, BarberDraft>>({});
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kapatilacak, setKapatilacak] = useState<string | null>(null);
  const [silinecek, setSilinecek] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['barbers', 'all'], queryFn: fetchAllBarbers });
  const barbers = query.data?.barbers ?? [];

  function draftFor(b: BarberAdmin): BarberDraft {
    return drafts[b.id] ?? { name: b.name, role: b.role };
  }

  function setDraft(b: BarberAdmin, patch: Partial<BarberDraft>) {
    setError(null);
    setDrafts({ ...drafts, [b.id]: { ...draftFor(b), ...patch } });
  }

  const mutation = useMutation({
    mutationFn: (input: { barber: BarberAdmin; isActive: boolean }) => {
      const draft = draftFor(input.barber);
      return updateBarber(input.barber.id, {
        name: draft.name.trim(),
        role: draft.role,
        isActive: input.isActive,
      });
    },
    onSuccess: (_veri, input) => {
      setSavedId(input.barber.id);
      setKapatilacak(null);
      setTimeout(() => setSavedId(null), 2000);

      // Takvim sekmeleri ve walk-in formu da bu listeden besleniyor.
      void queryClient.invalidateQueries({ queryKey: ['barbers'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    },
  });

  const silMutation = useMutation({
    mutationFn: (id: string) => deleteBarber(id),
    onSuccess: (sonuc) => {
      setSilinecek(null);
      // Kullanıcıya NE olduğunu söylüyoruz: silindi mi, kapatıldı mı?
      // "Sildim" deyip aslında kapatmak, berber listede durmaya devam
      // edince kafa karıştırırdı — zaten bu ekranın düzeltmeye çalıştığı
      // sorun tam olarak buydu.
      setBilgi(
        sonuc.mode === 'deleted'
          ? 'Berber silindi.'
          : `Berber kapatıldı. ${sonuc.appointmentCount} randevuda kaydı olduğu için ` +
            'tamamen silinemez; geçmiş randevularda adı görünmeye devam eder.',
      );
      setTimeout(() => setBilgi(null), 6000);
      void queryClient.invalidateQueries({ queryKey: ['barbers'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Berber kaldırılamadı');
    },
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
      {barbers.map((b) => {
        const draft = draftFor(b);
        const kendisi = b.id === oturumdaki?.id;

        return (
          <div className={`barber-row${b.isActive ? '' : ' pasif'}`} key={b.id}>
            <div className="barber-row-head">
              <span className="barber-row-email">{b.email}</span>
              {!b.isActive && <span className="barber-row-badge">Kapalı</span>}
              {kendisi && <span className="barber-row-badge kendisi">Siz</span>}
            </div>

            <label className="service-row-field barber-row-name">
              <span>Ad</span>
              <input
                type="text"
                value={draft.name}
                maxLength={120}
                onChange={(e) => setDraft(b, { name: e.target.value })}
              />
            </label>

            <label className="service-row-field">
              <span>Yetki</span>
              <select
                value={draft.role}
                onChange={(e) => setDraft(b, { role: e.target.value as BarberRole })}
              >
                <option value="staff">Berber</option>
                <option value="admin">Yönetici</option>
              </select>
            </label>

            <button
              type="button"
              className="btn btn-secondary service-row-save"
              onClick={() => {
                setError(null);
                mutation.mutate({ barber: b, isActive: b.isActive });
              }}
              disabled={mutation.isPending}
            >
              {savedId === b.id ? <Check size={16} aria-hidden /> : 'Kaydet'}
            </button>

            {/*
              Kapatma/açma ayrı bir düğme: ad ve yetki düzenlemesiyle aynı
              "Kaydet" işlemine bağlanırsa, adını düzeltmek isteyen biri
              farkında olmadan berberi kapatabilir.
            */}
            <button
              type="button"
              className="btn-icon barber-row-toggle"
              aria-label={b.isActive ? `${b.name} hesabını kapat` : `${b.name} hesabını aç`}
              title={b.isActive ? 'Hesabı kapat' : 'Hesabı aç'}
              disabled={mutation.isPending}
              onClick={() => {
                setError(null);
                if (b.isActive) {
                  setKapatilacak(kapatilacak === b.id ? null : b.id);
                } else {
                  mutation.mutate({ barber: b, isActive: true });
                }
              }}
            >
              {b.isActive ? <PowerOff size={16} aria-hidden /> : <Power size={16} aria-hidden />}
            </button>

            <button
              type="button"
              className="btn-icon service-row-delete"
              aria-label={`${b.name} kaydını kaldır`}
              title="Kaydı kaldır"
              disabled={silMutation.isPending}
              onClick={() => {
                setError(null);
                setKapatilacak(null);
                setSilinecek(silinecek === b.id ? null : b.id);
              }}
            >
              <Trash2 size={16} aria-hidden />
            </button>

            {silinecek === b.id && (
              <div className="service-confirm">
                <span>
                  <strong>{b.name}</strong> kaydı kaldırılsın mı? Hiç randevusu
                  yoksa tamamen silinir; randevusu varsa yalnızca kapatılır ve
                  geçmiş randevularda adı görünmeye devam eder.
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
                    onClick={() => silMutation.mutate(b.id)}
                    disabled={silMutation.isPending}
                  >
                    {silMutation.isPending ? <span className="spinner" /> : 'Evet, kaldır'}
                  </button>
                </div>
              </div>
            )}

            {kapatilacak === b.id && (
              <div className="service-confirm">
                <span>
                  <strong>{b.name}</strong> kapatılsın mı? Takvimde görünmez olur ve
                  müşteriler ona randevu alamaz. Geçmiş randevuları olduğu gibi kalır,
                  istediğiniz zaman tekrar açabilirsiniz.
                </span>
                <div className="service-confirm-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setKapatilacak(null)}
                    disabled={mutation.isPending}
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => mutation.mutate({ barber: b, isActive: false })}
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? <span className="spinner" /> : 'Evet, kapat'}
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

      {error && (
        <div className="form-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
