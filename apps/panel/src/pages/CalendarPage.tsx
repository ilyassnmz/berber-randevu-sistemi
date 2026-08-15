import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarOff } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import { fetchAppointments, fetchBarbers, fetchServices, fetchSlots } from '../lib/endpoints';
import { todayLocalDate } from '../lib/dates';
import type { Appointment, Slot } from '../lib/types';
import { DateNav } from '../components/DateNav';
import { AppointmentCard } from '../components/AppointmentCard';
import { SlotCard } from '../components/SlotCard';
import { WalkInModal } from '../components/WalkInModal';
import { AppointmentDetailModal } from '../components/AppointmentDetailModal';

type TimelineEntry =
  | { kind: 'appointment'; time: string; appointment: Appointment }
  | { kind: 'slot'; time: string; slot: Slot };

export default function CalendarPage() {
  const barber = useAuthStore((s) => s.barber);
  const isAdmin = barber?.role === 'admin';

  const [date, setDate] = useState(todayLocalDate());
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(
    isAdmin ? null : (barber?.id ?? null),
  );
  const [walkInSlot, setWalkInSlot] = useState<{ startsAt: string } | null>(null);
  const [detailAppointment, setDetailAppointment] = useState<Appointment | null>(null);

  const barbersQuery = useQuery({ queryKey: ['barbers'], queryFn: fetchBarbers });
  const servicesQuery = useQuery({ queryKey: ['services'], queryFn: fetchServices });

  const barbers = barbersQuery.data?.barbers ?? [];
  const services = servicesQuery.data?.services ?? [];

  // staff her zaman kendi kimliğine kilitli; admin için ilk berber varsayılan
  useEffect(() => {
    if (!isAdmin) {
      if (barber?.id) setSelectedBarberId(barber.id);
      return;
    }
    if (!selectedBarberId && barbers.length > 0) {
      setSelectedBarberId(barbers[0]!.id);
    }
  }, [isAdmin, barber?.id, barbers, selectedBarberId]);

  const activeBarberId = isAdmin ? selectedBarberId : (barber?.id ?? null);
  const activeBarberName = barbers.find((b) => b.id === activeBarberId)?.name ?? barber?.name ?? '';

  // Süre şu an tüm hizmetlerde aynı olduğu için günün ızgarasını hesaplamak
  // amacıyla herhangi bir aktif hizmet "referans" olarak kullanılabilir.
  const referenceServiceId = services[0]?.id ?? null;

  const appointmentsQuery = useQuery({
    queryKey: ['appointments', activeBarberId, date],
    queryFn: () => fetchAppointments({ barberId: activeBarberId!, date }),
    enabled: Boolean(activeBarberId),
  });

  const slotsQuery = useQuery({
    queryKey: ['slots', activeBarberId, referenceServiceId, date],
    queryFn: () => fetchSlots({ barberId: activeBarberId!, serviceId: referenceServiceId!, date }),
    enabled: Boolean(activeBarberId && referenceServiceId),
  });

  const timeline = useMemo<TimelineEntry[]>(() => {
    // İptal edilen randevular saati BLOKE ETMİYOR (backend zaten o saati boş
    // slot olarak dönüyor) — ama günün akışına dahil edilirse aynı saatte
    // hem "iptal edilmiş X" kartı hem "boş — ekle" kartı yan yana görünüp
    // o saat doluymuş izlenimi veriyordu. Berberin en sık kullandığı görünüm
    // (günün akışı) temiz kalsın diye burada gizleniyor; iptal geçmişi hâlâ
    // randevu detayında (cancelReason) ve ileride eklenecek bir geçmiş
    // ekranında görülebilir.
    const appointments = (appointmentsQuery.data?.items ?? []).filter(
      (a) => a.status !== 'cancelled',
    );
    const slots = slotsQuery.data?.slots ?? [];

    const entries: TimelineEntry[] = [
      ...appointments.map((a): TimelineEntry => ({ kind: 'appointment', time: a.startsAt, appointment: a })),
      ...slots.map((s): TimelineEntry => ({ kind: 'slot', time: s.startsAt, slot: s })),
    ];

    return entries.sort((a, b) => a.time.localeCompare(b.time));
  }, [appointmentsQuery.data, slotsQuery.data]);

  const isLoading = appointmentsQuery.isLoading || (Boolean(referenceServiceId) && slotsQuery.isLoading);
  const hasError = appointmentsQuery.isError || slotsQuery.isError;

  return (
    <div>
      {isAdmin && barbers.length > 1 && (
        <div className="barber-tabs">
          {barbers.map((b) => (
            <button
              key={b.id}
              className={`barber-tab ${b.id === activeBarberId ? 'active' : ''}`}
              onClick={() => setSelectedBarberId(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      <DateNav date={date} onChange={setDate} />

      {isLoading && (
        <div className="loading-center">
          <div className="spinner" />
        </div>
      )}

      {hasError && (
        <div className="banner banner-closed">Veriler yüklenemedi. Sayfayı yenilemeyi deneyin.</div>
      )}

      {!isLoading && !hasError && (
        <>
          {timeline.length === 0 && (
            <div className="state-message">
              <CalendarOff size={36} strokeWidth={1.5} aria-hidden />
              <span className="state-message-title">Bu gün için gösterilecek bir şey yok</span>
              <span>
                {referenceServiceId
                  ? 'Bu tarihte randevu ya da müsait saat bulunmuyor. Kapalı bir gün olabilir — Ayarlar’dan çalışma saatlerini kontrol edebilirsiniz.'
                  : 'Henüz hizmet tanımlı değil, bu yüzden saat ızgarası oluşturulamıyor.'}
              </span>
            </div>
          )}

          <div className="appointment-list">
            {timeline.map((entry) =>
              entry.kind === 'appointment' ? (
                <AppointmentCard
                  key={entry.appointment.id}
                  appointment={entry.appointment}
                  onClick={() => setDetailAppointment(entry.appointment)}
                />
              ) : (
                <SlotCard
                  key={entry.slot.startsAt}
                  label={entry.slot.label}
                  onClick={() => setWalkInSlot({ startsAt: entry.slot.startsAt })}
                />
              ),
            )}
          </div>
        </>
      )}

      {walkInSlot && activeBarberId && (
        <WalkInModal
          barberId={activeBarberId}
          barberName={activeBarberName}
          startsAt={walkInSlot.startsAt}
          date={date}
          services={services}
          onClose={() => setWalkInSlot(null)}
        />
      )}

      {detailAppointment && (
        <AppointmentDetailModal
          appointment={detailAppointment}
          date={date}
          onClose={() => setDetailAppointment(null)}
        />
      )}
    </div>
  );
}
