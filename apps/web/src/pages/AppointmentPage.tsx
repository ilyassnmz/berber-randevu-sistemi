import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarX2, AlertCircle, Phone, ChevronLeft } from 'lucide-react';
import { fetchAppointment, fetchShopInfo, cancelAppointment, ApiError } from '../lib/api';
import { forgetToken } from '../lib/storage';
import { formatAppointmentMoment, formatPrice } from '../lib/dates';

/**
 * Randevu görüntüleme ve iptal.
 *
 * Adresteki anahtar tek başına yetki taşıyor — giriş yok. Anahtar 192 bit
 * rastgele olduğu için tahmin edilemez; bilen yalnızca randevuyu alan kişi
 * (ve bağlantıyı paylaştığı kişiler).
 */
export default function AppointmentPage() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const shopQuery = useQuery({ queryKey: ['shop'], queryFn: fetchShopInfo });
  const appointmentQuery = useQuery({
    queryKey: ['appointment', token],
    queryFn: () => fetchAppointment(token),
    retry: false,
  });

  const timezone = shopQuery.data?.shop.timezone ?? 'Europe/Istanbul';
  const contactPhone = shopQuery.data?.shop.contactPhone ?? null;

  const mutation = useMutation({
    mutationFn: () => cancelAppointment(token),
    onSuccess: () => {
      setConfirming(false);
      // Artık aktif değil; "daha önce aldığınız randevu" bağlantısında
      // görünmeye devam etmesin.
      forgetToken(token);
      void queryClient.invalidateQueries({ queryKey: ['appointment', token] });
    },
    onError: (error) => {
      setConfirming(false);
      setCancelError(
        error instanceof ApiError ? error.message : 'Randevu iptal edilemedi.',
      );
    },
  });

  if (appointmentQuery.isLoading) {
    return (
      <div className="page">
        <div className="loading-center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (appointmentQuery.isError || !appointmentQuery.data) {
    return (
      <div className="page">
        <div className="result-icon result-icon-cancelled">
          <AlertCircle size={30} aria-hidden />
        </div>
        <h1 className="result-title">Randevu bulunamadı</h1>
        <p className="result-text">
          Bağlantı hatalı ya da randevu artık geçerli değil.
          {contactPhone && ' Bilgi için bizi arayabilirsiniz.'}
        </p>

        {contactPhone && (
          <a href={`tel:${contactPhone}`} className="btn btn-secondary btn-block" style={{ marginBottom: 10 }}>
            <Phone size={17} aria-hidden /> {contactPhone}
          </a>
        )}

        <Link to="/" className="btn btn-primary btn-block">
          Yeni randevu al
        </Link>
      </div>
    );
  }

  const appointment = appointmentQuery.data.appointment;
  const isCancelled = appointment.status === 'cancelled';
  const isPast = new Date(appointment.startsAt).getTime() < Date.now();
  const canCancel = !isCancelled && !isPast;

  return (
    <div className="page">
      <Link to="/" className="btn-back">
        <ChevronLeft size={17} aria-hidden /> Ana sayfa
      </Link>

      <div className={`result-icon ${isCancelled ? 'result-icon-cancelled' : 'result-icon-success'}`}>
        {isCancelled ? <CalendarX2 size={30} aria-hidden /> : <CalendarCheck size={30} aria-hidden />}
      </div>

      <h1 className="result-title">
        {isCancelled ? 'Randevunuz iptal edildi' : isPast ? 'Geçmiş randevu' : 'Randevunuz hazır'}
      </h1>

      <p className="result-text">{formatAppointmentMoment(appointment.startsAt, timezone)}</p>

      <div className="summary">
        {appointment.customerName && (
          <div className="summary-row">
            <span>Ad Soyad</span>
            <span>{appointment.customerName}</span>
          </div>
        )}
        <div className="summary-row">
          <span>Usta</span>
          <span>{appointment.barberName}</span>
        </div>
        <div className="summary-row">
          <span>Hizmet</span>
          <span>
            {appointment.serviceName}
            {formatPrice(appointment.servicePrice) ? ` · ${formatPrice(appointment.servicePrice)}` : ''}
          </span>
        </div>
        {isCancelled && appointment.cancelReason && (
          <div className="summary-row">
            <span>İptal sebebi</span>
            <span>{appointment.cancelReason}</span>
          </div>
        )}
      </div>

      {cancelError && (
        <div className="notice notice-error" role="alert">
          <AlertCircle size={17} aria-hidden />
          <span>
            {cancelError}
            {contactPhone && ` Bizi arayabilirsiniz: ${contactPhone}`}
          </span>
        </div>
      )}

      {canCancel && !confirming && (
        <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirming(true)}>
          Randevumu iptal et
        </button>
      )}

      {canCancel && confirming && (
        <>
          <div className="notice notice-info">
            <AlertCircle size={17} aria-hidden />
            <span>Randevunuzu iptal etmek istediğinizden emin misiniz?</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={() => setConfirming(false)}
              disabled={mutation.isPending}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="btn btn-danger"
              style={{ flex: 1 }}
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <span className="spinner" /> : 'Evet, iptal et'}
            </button>
          </div>
        </>
      )}

      {isCancelled && (
        <Link to="/" className="btn btn-primary btn-block">
          Yeni randevu al
        </Link>
      )}

      <footer className="site-footer">
        {contactPhone && (
          <p>
            <a href={`tel:${contactPhone}`}>
              <Phone size={13} aria-hidden /> {contactPhone}
            </a>
          </p>
        )}
      </footer>
    </div>
  );
}
