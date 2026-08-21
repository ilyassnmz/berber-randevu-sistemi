import { useEffect, useState } from 'react';
import { Bell, BellOff, AlertCircle } from 'lucide-react';
import { fetchPushKey, subscribePush, unsubscribePush } from '../lib/endpoints';

/**
 * Bildirim aç/kapa.
 *
 * Müşteri siteden randevu aldığında berberin telefonuna bildirim düşer.
 * Randevu berbere aitse "Yeni randevunuz var", başkasınaysa (Müslüm patron
 * olduğu için Fırat'ın randevularını da görüyor) "Fırat için yeni randevu".
 *
 * ── Neden bir düğme, otomatik değil? ──────────────────────────────
 *
 * Tarayıcı bildirim iznini yalnızca kullanıcı bir şeye TIKLADIĞINDA
 * soruyor. Sayfa açılır açılmaz istemek hem tarayıcılar tarafından
 * engelleniyor hem de kullanıcıyı ürkütüp kalıcı "reddet" almaya götürüyor.
 */
export function NotificationToggle() {
  const [durum, setDurum] = useState<'yukleniyor' | 'kapali' | 'acik' | 'reddedildi' | 'desteklenmiyor'>(
    'yukleniyor',
  );
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setDurum('desteklenmiyor');
        return;
      }
      if (Notification.permission === 'denied') {
        setDurum('reddedildi');
        return;
      }

      const kayit = await navigator.serviceWorker.ready;
      const abone = await kayit.pushManager.getSubscription();
      setDurum(abone ? 'acik' : 'kapali');
    })();
  }, []);

  async function ac() {
    setHata(null);
    setIslemde(true);
    try {
      const { publicKey, enabled } = await fetchPushKey();
      if (!enabled || !publicKey) {
        setHata('Bildirimler sunucuda yapılandırılmamış.');
        return;
      }

      const izin = await Notification.requestPermission();
      if (izin !== 'granted') {
        setDurum(izin === 'denied' ? 'reddedildi' : 'kapali');
        return;
      }

      const kayit = await navigator.serviceWorker.ready;
      const abone = await kayit.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

      await subscribePush(abone.toJSON());
      setDurum('acik');
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Bildirimler açılamadı');
    } finally {
      setIslemde(false);
    }
  }

  async function kapat() {
    setHata(null);
    setIslemde(true);
    try {
      const kayit = await navigator.serviceWorker.ready;
      const abone = await kayit.pushManager.getSubscription();
      if (abone) {
        // Sunucudan ÖNCE silinir: tarayıcı aboneliği kalkarsa sunucudaki
        // kayıt zaten geçersiz olur ve ilk gönderimde otomatik temizlenir.
        await unsubscribePush(abone.endpoint).catch(() => {});
        await abone.unsubscribe();
      }
      setDurum('kapali');
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Bildirimler kapatılamadı');
    } finally {
      setIslemde(false);
    }
  }

  if (durum === 'yukleniyor') return <div className="spinner" />;

  if (durum === 'desteklenmiyor') {
    return (
      <p className="settings-section-hint">
        Bu tarayıcı bildirimleri desteklemiyor. Paneli ana ekrana ekleyip oradan
        açarsanız çalışabilir.
      </p>
    );
  }

  if (durum === 'reddedildi') {
    return (
      <div className="notice notice-error">
        <AlertCircle size={17} aria-hidden />
        <span>
          Bildirimlere izin verilmemiş. Tarayıcı ayarlarından bu site için
          bildirimlere izin verip sayfayı yenileyin.
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`btn ${durum === 'acik' ? 'btn-secondary' : 'btn-primary'} btn-block`}
        onClick={durum === 'acik' ? kapat : ac}
        disabled={islemde}
      >
        {islemde ? (
          <span className="spinner" />
        ) : durum === 'acik' ? (
          <>
            <BellOff size={16} aria-hidden /> Bildirimleri kapat
          </>
        ) : (
          <>
            <Bell size={16} aria-hidden /> Bildirimleri aç
          </>
        )}
      </button>

      {hata && (
        <div className="form-error" role="alert" style={{ marginTop: 10 }}>
          {hata}
        </div>
      )}
    </>
  );
}
