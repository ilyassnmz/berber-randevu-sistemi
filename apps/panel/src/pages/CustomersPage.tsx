import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, Search, UsersRound, Ban } from 'lucide-react';
import { fetchCustomers } from '../lib/endpoints';
import { CustomerDetailModal } from '../components/CustomerDetailModal';
import { formatPhoneForDisplay } from '@berber/shared';

/**
 * Müşteri listesi — arama + kara liste filtresi + sayfalama.
 *
 * Backend uçları (`GET /customers`, `GET /customers/:id`) daha önce
 * eklenmişti ama panelde hiçbir ekran bunları kullanmıyordu.
 */
export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [blacklistedOnly, setBlacklistedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['customers', search, blacklistedOnly],
    queryFn: () =>
      fetchCustomers({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(blacklistedOnly ? { blacklistedOnly: true } : {}),
        limit: 50,
      }),
  });

  const customers = query.data?.items ?? [];

  return (
    <div>
      <Link to="/" className="settings-back">
        <ChevronLeft size={16} aria-hidden /> Takvime dön
      </Link>

      <div className="customer-search">
        <Search size={16} aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="İsim veya telefon ara…"
          aria-label="Müşteri ara"
        />
      </div>

      <div className="barber-tabs">
        <button
          type="button"
          className={`barber-tab ${!blacklistedOnly ? 'active' : ''}`}
          onClick={() => setBlacklistedOnly(false)}
        >
          Tümü
        </button>
        <button
          type="button"
          className={`barber-tab ${blacklistedOnly ? 'active' : ''}`}
          onClick={() => setBlacklistedOnly(true)}
        >
          Kara liste
        </button>
      </div>

      {query.isLoading && (
        <div className="loading-center">
          <div className="spinner" />
        </div>
      )}

      {query.isError && (
        <div className="banner banner-closed">Müşteriler yüklenemedi. Sayfayı yenilemeyi deneyin.</div>
      )}

      {!query.isLoading && !query.isError && customers.length === 0 && (
        <div className="state-message">
          <UsersRound size={36} strokeWidth={1.5} aria-hidden />
          <span className="state-message-title">
            {search.trim() ? 'Eşleşen müşteri yok' : 'Henüz müşteri kaydı yok'}
          </span>
          <span>
            {search.trim()
              ? 'Farklı bir isim ya da numara deneyin.'
              : 'WhatsApp’tan randevu alan ve panelden eklenen müşteriler burada listelenir.'}
          </span>
        </div>
      )}

      <div className="appointment-list">
        {customers.map((c) => (
          <button key={c.id} className="customer-row" onClick={() => setSelectedId(c.id)}>
            <div className="customer-row-info">
              <div className="customer-row-name">
                {c.name ?? 'İsimsiz müşteri'}
                {c.isBlacklisted && <Ban size={13} aria-hidden className="appt-warn" />}
              </div>
              <div className="customer-row-meta">
                {c.phone ? formatPhoneForDisplay(c.phone) : 'Telefon yok'}
                {c.noShowCount > 0 && ` · ${c.noShowCount} kez gelmedi`}
              </div>
            </div>
          </button>
        ))}
      </div>

      {selectedId && (
        <CustomerDetailModal customerId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
