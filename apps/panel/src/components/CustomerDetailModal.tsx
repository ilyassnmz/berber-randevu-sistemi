import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, CalendarOff, MessageCircle } from 'lucide-react';
import { formatPhoneForDisplay } from '@berber/shared';
import { fetchCustomer, blacklistCustomer, unblacklistCustomer } from '../lib/endpoints';
import { ApiError } from '../lib/api';
import { formatDateTr, formatTimeTr } from '../lib/dates';
import { StatusBadge } from './StatusBadge';

interface Props {
  customerId: string;
  onClose: () => void;
}

/** Müşteri detayı: iletişim bilgileri, gelmedi sayacı ve randevu geçmişi. */
export function CustomerDetailModal({ customerId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmingBlacklist, setConfirmingBlacklist] = useState(false);

  const query = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(customerId),
  });

  const customer = query.data?.customer;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
  }

  const blacklistMutation = useMutation({
    mutationFn: () => blacklistCustomer(customerId, 'Panelden kara listeye alındı'),
    onSuccess: () => {
      setConfirmingBlacklist(false);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İşlem başarısız'),
  });

  const unblacklistMutation = useMutation({
    mutationFn: () => unblacklistCustomer(customerId),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İşlem başarısız'),
  });

  const pending = blacklistMutation.isPending || unblacklistMutation.isPending;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Müşteri Detayı</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Kapat">
            <X size={18} aria-hidden />
          </button>
        </div>

        {query.isLoading && (
          <div className="loading-center">
            <div className="spinner" />
          </div>
        )}

        {customer && (
          <>
            <div className="detail-row">
              <span>Ad</span>
              <strong>{customer.name ?? 'İsimsiz müşteri'}</strong>
            </div>
            <div className="detail-row">
              <span>Telefon</span>
              {customer.phone ? (
                <span className="phone-actions">
                  <a href={`tel:${customer.phone}`} title="Ara">
                    {formatPhoneForDisplay(customer.phone)}
                  </a>
                  <a
                    href={`https://wa.me/${customer.phone.replace('+', '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-icon phone-wa"
                    aria-label="WhatsApp'tan yaz"
                    title="WhatsApp'tan yaz"
                  >
                    <MessageCircle size={16} aria-hidden />
                  </a>
                </span>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="detail-row">
              <span>Gelmedi sayısı</span>
              <span>{customer.noShowCount}</span>
            </div>
            <div className="detail-row">
              <span>Toplam randevu</span>
              <span>{customer.appointments.length}</span>
            </div>
            {customer.isBlacklisted && customer.blacklistNote && (
              <div className="detail-row">
                <span>Kara liste notu</span>
                <span>{customer.blacklistNote}</span>
              </div>
            )}

            {error && (
              <div className="form-error" role="alert" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}

            <div className="modal-actions">
              {customer.isBlacklisted ? (
                <button
                  className="btn btn-secondary btn-block"
                  onClick={() => unblacklistMutation.mutate()}
                  disabled={pending}
                >
                  {unblacklistMutation.isPending ? (
                    <span className="spinner" />
                  ) : (
                    'Kara Listeden Çıkar'
                  )}
                </button>
              ) : confirmingBlacklist ? (
                <div className="modal-actions-row">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setConfirmingBlacklist(false)}
                    disabled={pending}
                  >
                    Vazgeç
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => blacklistMutation.mutate()}
                    disabled={pending}
                  >
                    {blacklistMutation.isPending ? <span className="spinner" /> : 'Kara Listeye Al'}
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-secondary btn-block"
                  onClick={() => setConfirmingBlacklist(true)}
                  disabled={pending}
                >
                  Müşteriyi Kara Listeye Al
                </button>
              )}
            </div>

            <h3 className="customer-history-title">Randevu Geçmişi</h3>

            {customer.appointments.length === 0 ? (
              <div className="state-message">
                <CalendarOff size={30} strokeWidth={1.5} aria-hidden />
                <span>Bu müşterinin henüz randevusu yok.</span>
              </div>
            ) : (
              <div className="customer-history">
                {customer.appointments.map((a) => (
                  <div className="customer-history-item" key={a.id}>
                    <div className="customer-history-when">
                      <strong>{formatDateTr(a.startsAt.slice(0, 10))}</strong>
                      <span>{formatTimeTr(a.startsAt)}</span>
                    </div>
                    <div className="customer-history-what">
                      {a.service.name} · {a.barber.name}
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
