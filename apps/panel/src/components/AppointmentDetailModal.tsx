import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Appointment } from '../lib/types';
import { formatDateTr, formatTimeTr } from '../lib/dates';
import { StatusBadge } from './StatusBadge';
import { RescheduleModal } from './RescheduleModal';
import {
  cancelAppointment,
  completeAppointment,
  markNoShow,
  blacklistCustomer,
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
            ✕
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
              <a href={`https://wa.me/${appointment.customer.phone.replace('+', '')}`} target="_blank" rel="noreferrer">
                {appointment.customer.phone}
              </a>
            ) : (
              <span>—</span>
            )}
          </div>
          <div className="detail-row">
            <span>Hizmet</span>
            <span>{appointment.service.name}</span>
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
                ✅ Tamamlandı
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => noShowMutation.mutate()}
                disabled={anyPending}
              >
                🚫 Gelmedi
              </button>
            </div>

            {confirming === null && (
              <button
                className="btn btn-secondary btn-block"
                onClick={() => setShowReschedule(true)}
                disabled={anyPending}
              >
                🕘 Saati Değiştir
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
