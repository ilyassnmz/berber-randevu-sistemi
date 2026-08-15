import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, BarChart3 } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import { fetchStats, fetchBarbers } from '../lib/endpoints';
import { addDaysToDate, todayLocalDate } from '../lib/dates';
import { STATUS_LABELS_TR } from '../lib/types';
import type { AppointmentStatus } from '../lib/types';

type RangeKey = '7' | '30' | '90';

const RANGE_LABELS: Record<RangeKey, string> = {
  '7': 'Son 7 gün',
  '30': 'Son 30 gün',
  '90': 'Son 90 gün',
};

/** Yüzde — 0 randevuda sıfıra bölme olmasın. */
function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

export default function StatsPage() {
  const barber = useAuthStore((s) => s.barber);
  const isAdmin = barber?.role === 'admin';

  const [range, setRange] = useState<RangeKey>('30');
  const [barberId, setBarberId] = useState<string | null>(null);

  const to = todayLocalDate();
  const from = addDaysToDate(to, -Number(range) + 1);

  const barbersQuery = useQuery({ queryKey: ['barbers'], queryFn: fetchBarbers, enabled: isAdmin });
  const barbers = barbersQuery.data?.barbers ?? [];

  const query = useQuery({
    queryKey: ['stats', from, to, barberId],
    queryFn: () => fetchStats({ from, to, ...(barberId ? { barberId } : {}) }),
  });

  const stats = query.data;
  const statusOrder: AppointmentStatus[] = [
    'completed',
    'confirmed',
    'pending_confirm',
    'cancelled',
    'no_show',
  ];

  return (
    <div>
      <Link to="/" className="settings-back">
        <ChevronLeft size={16} aria-hidden /> Takvime dön
      </Link>

      <div className="barber-tabs">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`barber-tab ${range === key ? 'active' : ''}`}
            onClick={() => setRange(key)}
          >
            {RANGE_LABELS[key]}
          </button>
        ))}
      </div>

      {isAdmin && barbers.length > 1 && (
        <div className="barber-tabs">
          <button
            type="button"
            className={`barber-tab ${barberId === null ? 'active' : ''}`}
            onClick={() => setBarberId(null)}
          >
            Tüm dükkan
          </button>
          {barbers.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`barber-tab ${barberId === b.id ? 'active' : ''}`}
              onClick={() => setBarberId(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      {query.isLoading && (
        <div className="loading-center">
          <div className="spinner" />
        </div>
      )}

      {query.isError && (
        <div className="banner banner-closed">İstatistikler yüklenemedi.</div>
      )}

      {stats && stats.total === 0 && (
        <div className="state-message">
          <BarChart3 size={36} strokeWidth={1.5} aria-hidden />
          <span className="state-message-title">Bu dönemde randevu yok</span>
          <span>Daha geniş bir tarih aralığı seçmeyi deneyin.</span>
        </div>
      )}

      {stats && stats.total > 0 && (
        <>
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-tile-value">{stats.total}</span>
              <span className="stat-tile-label">Toplam randevu</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">{stats.uniqueCustomers}</span>
              <span className="stat-tile-label">Farklı müşteri</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile-value">
                %{pct(stats.byStatus.completed, stats.total)}
              </span>
              <span className="stat-tile-label">Tamamlanma</span>
            </div>
            <div className="stat-tile" data-tone={stats.byStatus.no_show > 0 ? 'warn' : undefined}>
              <span className="stat-tile-value">%{pct(stats.byStatus.no_show, stats.total)}</span>
              <span className="stat-tile-label">Gelmedi</span>
            </div>
          </div>

          <div className="settings-section">
            <h2>Durum dağılımı</h2>
            {statusOrder.map((status) => {
              const count = stats.byStatus[status];
              if (count === 0) return null;
              return (
                <div className="stat-bar-row" key={status}>
                  <span className="stat-bar-label">{STATUS_LABELS_TR[status]}</span>
                  <div className="stat-bar-track">
                    <div
                      className="stat-bar-fill"
                      data-status={status}
                      style={{ width: `${pct(count, stats.total)}%` }}
                    />
                  </div>
                  <span className="stat-bar-value">{count}</span>
                </div>
              );
            })}
          </div>

          <div className="settings-section">
            <h2>Randevu kaynağı</h2>
            <div className="detail-row">
              <span>WhatsApp</span>
              <strong>
                {stats.bySource.whatsapp} (%{pct(stats.bySource.whatsapp, stats.total)})
              </strong>
            </div>
            <div className="detail-row">
              <span>Panelden eklenen</span>
              <strong>
                {stats.bySource.panel} (%{pct(stats.bySource.panel, stats.total)})
              </strong>
            </div>
          </div>

          {stats.byBarber.length > 1 && (
            <div className="settings-section">
              <h2>Berbere göre</h2>
              {stats.byBarber.map((b) => (
                <div className="stat-bar-row" key={b.barberId}>
                  <span className="stat-bar-label">{b.name}</span>
                  <div className="stat-bar-track">
                    <div
                      className="stat-bar-fill"
                      data-status="confirmed"
                      style={{ width: `${pct(b.count, stats.total)}%` }}
                    />
                  </div>
                  <span className="stat-bar-value">{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
