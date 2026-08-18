import { useState } from 'react';
import { X, CheckCheck, UserX, Clock, MessageCircle, ShieldAlert } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Appointment } from '../lib/types';
import { formatPhoneForDisplay } from '@berber/shared';
import { formatDateTr, formatTimeTr, formatPrice } from '../lib/dates';
import { StatusBadge } from './StatusBadge';
import { RescheduleModal } from './RescheduleModal';
import {
  cancelAppointment,
  completeAppointment,
  markNoShow,
  blacklistCustomer,
  fetchSiblingAppointments,
  cancelSiblingAppointments,
} from '../lib/endpoints';
import { ApiError } from '../lib/api';

interface Props {
  appointment: Appointment;
  date: string;
  onClose: () => void;
}

type ConfirmKind = 'cancel' | 'blacklist' | null;

const ACTIVE_STATUSES = new Set(['pending_confirm', 'confirmed']);

export function AppointmentDetailModal({ appointment, date, onClose }: Props) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<ConfirmKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showReschedule, setShowReschedule] = useState(false);

  const isActive = ACTIVE_STATUSES.has(appointment.status);

  /**
   * Aynı cihazdan gelen diğer randevular.
   *
   * Yalnızca siteden alınan randevularda anlamlı; panelden girilenlerde
   * cihaz bilgisi yok ve uç boş liste döner.
   */
  const siblingsQuery = useQuery({
    queryKey: ['siblings', appointment.id],
    queryFn: () => fetchSiblingAppointments(appointment.id),
    enabled: appointment.source === 'web',
  });

  // Kendisi de listede; "diğerleri" için bir eksiltiyoruz.
  const digerleri = Math.max(0, (siblingsQuery.data?.items.length ?? 0) - 1);

  const cancelSiblingsMutation = useMutation({
    mutationFn: () => cancelSiblingAppointments(appointment.id),
    onSuccess: invalidateAndClose,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İşlem başarısız'),
  });

  function invalidateAndClose() {
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    void queryClient.invalidateQueries({ queryKey: ['slots'] });
    onClose();
  }

  const completeMutation = useMutation({
    mutationFn: () => completeAppointment(appointment.id),
    onSuccess: invalidateAndClose,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İşlem başarısız'),
  });

  const noShowMutation = useMutation({
    mutationFn: () => markNoShow(appointment.id),
    onSuccess: invalidateAndClose,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İşlem başarısız'),
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      cancelAppointment(appointment.id, cancelReason.trim() || 'Berber tarafından iptal edildi'),
    onSuccess: invalidateAndClose,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İşlem başarısız'),
  });

  const blacklistMutation = useMutation({
    mutationFn: () => blacklistCustomer(appointment.customerId, 'Panelden kara listeye alındı'),
    onSuccess: invalidateAndClose,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'İşlem başarısız'),
  });

  const anyPending =
    completeMutation.isPending ||
    noShowMutation.isPending ||
    cancelMutation.isPending ||
    blacklistMutation.isPending;

  if (showReschedule) {
    return (
      <RescheduleModal
        appointment={appointment}
        onClose={() => setShowReschedule(false)}
        onRescheduled={onClose}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Randevu Detayı</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Kapat">
            <X size={18} aria-hidden />
          </button>
        </div>

        <StatusBadge status={appointment.status} />

        <div style={{ marginTop: 16 }}>
          <div className="detail-row">
            <span>Müşteri</span>
            <strong>{appointment.customer.name ?? 'İsimsiz müşteri'}</strong>
          </div>
          <div className="detail-row">
            <span>Telefon</span>
            {appointment.customer.phone ? (
              <span className="phone-actions">
                {/* Numara okunabilir yerel biçimde; bağlantılar ise ham
                    E.164 kullanıyor — wa.me ve tel: bunu bekliyor. */}
                <a href={`tel:${appointment.customer.phone}`} title="Ara">
                  {formatPhoneForDisplay(appointment.customer.phone)}
                </a>
                <a
                  href={`https://wa.me/${appointment.customer.phone.replace('+', '')}`}
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
            <span>Hizmet</span>
            <span>
              {appointment.service.name}
              {formatPrice(appointment.service.price) && (
                <strong> · {formatPrice(appointment.service.price)}</strong>
              )}
            </span>
          </div>
          <div className="detail-row">
            <span>Tarih / Saat</span>
            <span>
              {formatDateTr(date)} · {appointment.localStartTime ?? formatTimeTr(appointment.startsAt)}
            </span>
          </div>
          <div className="detail-row">
            <span>Kaynak</span>
            <span>{appointment.source === 'panel' ? 'Panelden eklendi' : 'WhatsApp'}</span>
          </div>
          {appointment.customer.noShowCount > 0 && (
            <div className="detail-row">
              <span>Geçmişte gelmedi</span>
              <span>{appointment.customer.noShowCount} kez</span>
            </div>
          )}
          {appointment.cancelReason && (
            <div className="detail-row">
              <span>İptal sebebi</span>
              <span>{appointment.cancelReason}</span>
            </div>
          )}
        </div>

        {error && (
          <div className="form-error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        {isActive && (
          <div className="modal-actions">
            <div className="modal-actions-row">
              <button
                className="btn btn-primary"
                onClick={() => completeMutation.mutate()}
                disabled={anyPending}
              >
                <CheckCheck size={16} aria-hidden /> Tamamlandı
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => noShowMutation.mutate()}
                disabled={anyPending}
              >
                <UserX size={16} aria-hidden /> Gelmedi
              </button>
            </div>

            {confirming === null && (
              <button
                className="btn btn-secondary btn-block"
                onClick={() => setShowReschedule(true)}
                disabled={anyPending}
              >
                <Clock size={16} aria-hidden /> Saati Değiştir
              </button>
            )}

            {confirming === 'cancel' ? (
              <>
                <label className="field">
                  <span>İptal sebebi (opsiyonel)</span>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Berber tarafından iptal edildi"
                    disabled={anyPending}
                    maxLength={500}
                  />
                </label>
                <div className="modal-actions-row">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setConfirming(null);
                      setCancelReason('');
                    }}
                    disabled={anyPending}
                  >
                    Vazgeç
                  </button>
                  <button className="btn btn-danger" onClick={() => cancelMutation.mutate()} disabled={anyPending}>
                    {cancelMutation.isPending ? <span className="spinner" /> : 'Evet, iptal et'}
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-danger btn-block" onClick={() => setConfirming('cancel')} disabled={anyPending}>
                Randevuyu İptal Et
              </button>
            )}
          </div>
        )}

        {digerleri > 0 && (
          <div className="sibling-warning">
            <div className="sibling-warning-head">
              <ShieldAlert size={16} aria-hidden />
              <span>Aynı cihazdan {digerleri} randevu daha var</span>
            </div>
            <p>
              Farklı isim ve numaralarla alınmış olabilirler. Sahte randevu
              şüphesi varsa hepsini tek seferde iptal edebilirsiniz.
            </p>
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => cancelSiblingsMutation.mutate()}
              disabled={cancelSiblingsMutation.isPending}
            >
              {cancelSiblingsMutation.isPending ? (
                <span className="spinner" />
              ) : (
                `Bu cihazdan gelen ${digerleri + 1} randevuyu iptal et`
              )}
            </button>
          </div>
        )}

        {!appointment.customer.isBlacklisted && (
          <div className="modal-actions">
            {confirming === 'blacklist' ? (
              <div className="modal-actions-row">
                <button className="btn btn-secondary" onClick={() => setConfirming(null)} disabled={anyPending}>
                  Vazgeç
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => blacklistMutation.mutate()}
                  disabled={anyPending}
                >
                  {blacklistMutation.isPending ? <span className="spinner" /> : 'Kara Listeye Al'}
                </button>
              </div>
            ) : (
              <button
                className="btn btn-secondary btn-block"
                onClick={() => setConfirming('blacklist')}
                disabled={anyPending}
              >
                Müşteriyi Kara Listeye Al
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
