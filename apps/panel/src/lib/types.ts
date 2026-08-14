/**
 * Backend yanıtlarıyla birebir eşleşen tipler.
 *
 * Rol ve durum ENUM'ları `@berber/shared`'dan geliyor — burada tekrar
 * tanımlanmıyor. Backend yeni bir durum eklerse (ör. yeni bir
 * `AppointmentStatus` değeri) panel derlemesi kırılır ve unutulan yer
 * (StatusBadge'in ICONS sözlüğü gibi) derleme zamanında yakalanır; iki ayrı
 * tip tanımıyla bu sessizce `undefined` render edilirdi.
 */
export type { BarberRole, AppointmentStatus, CancelledBy, AppointmentSource } from '@berber/shared';
import type { BarberRole, AppointmentStatus, CancelledBy, AppointmentSource } from '@berber/shared';

export interface Barber {
  id: string;
  name: string;
  role: BarberRole;
}

export interface AuthBarber {
  id: string;
  shopId: string;
  name: string;
  email: string;
  role: BarberRole;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  price: string | null;
}

export interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  noShowCount: number;
  isBlacklisted: boolean;
}

export interface Appointment {
  id: string;
  shopId: string;
  barberId: string;
  customerId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  cancelledBy: CancelledBy | null;
  cancelReason: string | null;
  source: AppointmentSource;
  createdAt: string;
  customer: Customer;
  service: { id: string; name: string; durationMin: number };
  barber: { id: string; name: string };
  localStartTime?: string;
  localEndTime?: string;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  label: string;
}

export const STATUS_LABELS_TR: Record<AppointmentStatus, string> = {
  pending_confirm: 'Onay bekliyor',
  confirmed: 'Onaylandı',
  cancelled: 'İptal edildi',
  completed: 'Tamamlandı',
  no_show: 'Gelmedi',
};
