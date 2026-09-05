import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, KeyRound } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import { fetchBarbers } from '../lib/endpoints';
import { WorkingHoursEditor } from '../components/WorkingHoursEditor';
import { TimeOffManager } from '../components/TimeOffManager';
import { AddBarberForm } from '../components/AddBarberForm';
import { BarbersEditor } from '../components/BarbersEditor';
import { ServicesEditor } from '../components/ServicesEditor';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { NotificationToggle } from '../components/NotificationToggle';

export default function SettingsPage() {
  const barber = useAuthStore((s) => s.barber);
  const isAdmin = barber?.role === 'admin';
  const [scheduleBarberId, setScheduleBarberId] = useState<string | null>(barber?.id ?? null);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const barbersQuery = useQuery({
    queryKey: ['barbers'],
    queryFn: fetchBarbers,
    enabled: isAdmin,
  });
  const barbers = barbersQuery.data?.barbers ?? [];

  const activeScheduleBarberId = isAdmin ? (scheduleBarberId ?? barber?.id ?? null) : (barber?.id ?? null);

  return (
    <div>
      <Link to="/" className="settings-back">
        <ChevronLeft size={16} aria-hidden /> Takvime dön
      </Link>

      <div className="settings-section">
        <h2>Hesap</h2>
        <p className="settings-section-hint">{barber?.name} · {barber?.email}</p>
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setShowChangePassword(true)}>
          <KeyRound size={16} aria-hidden /> Şifre Değiştir
        </button>
      </div>

      <div className="settings-section">
        <h2>Bildirimler</h2>
        <p className="settings-section-hint">
          Müşteri siteden randevu aldığında telefonunuza bildirim gelir.
          Her cihaz için ayrı açılması gerekir.
        </p>
        <NotificationToggle />
      </div>

      <div className="settings-section">
        <h2>Çalışma Saatleri</h2>
        <p className="settings-section-hint">
          {isAdmin
            ? 'Herhangi bir berberin haftalık programını buradan değiştirebilirsiniz.'
            : 'Haftalık çalışma programınız.'}
        </p>

        {isAdmin && barbers.length > 1 && (
          <div className="barber-tabs">
            {barbers.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`barber-tab ${b.id === activeScheduleBarberId ? 'active' : ''}`}
                onClick={() => setScheduleBarberId(b.id)}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}

        {activeScheduleBarberId && <WorkingHoursEditor key={activeScheduleBarberId} barberId={activeScheduleBarberId} />}
      </div>

      <div className="settings-section">
        <h2>İzin Günleri</h2>
        <p className="settings-section-hint">
          Belirli bir günü kapatmak için tarih seçip "Bu Günü Kapat"a basın —
          o gün için randevu alınamaz hale gelir.
        </p>
        {activeScheduleBarberId && <TimeOffManager key={activeScheduleBarberId} barberId={activeScheduleBarberId} />}
      </div>

      {isAdmin && (
        <div className="settings-section">
          <h2>Hizmetler</h2>
          <p className="settings-section-hint">
            Ad, süre ve fiyat. Süre değişikliği yalnızca yeni randevuları
            etkiler — mevcut randevular oldukları gibi kalır. Ad değişikliği
            geçmiş randevularda da yeni adıyla görünür.
          </p>
          <ServicesEditor />
        </div>
      )}

      {isAdmin && (
        <div className="settings-section">
          <h2>Berberler</h2>
          <p className="settings-section-hint">
            Ad ve yetki düzenlenebilir. Bir berberi kapattığınızda takvimden ve
            müşteri sitesinden kalkar; geçmiş randevuları korunur ve istediğiniz
            zaman tekrar açabilirsiniz.
          </p>
          <BarbersEditor />
        </div>
      )}

      {isAdmin && (
        <div className="settings-section">
          <h2>Yeni Berber Ekle</h2>
          <p className="settings-section-hint">
            Eklenen berber için varsayılan program (Pazar hariç 09:00-20:15) otomatik oluşturulur.
          </p>
          <AddBarberForm />
        </div>
      )}

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}
