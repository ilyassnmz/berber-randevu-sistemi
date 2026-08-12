/** Backend yanıtlarıyla birebir eşleşen tipler. */

export type BarberRole = 'admin' | 'staff';

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
  isActive?: boolean;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  price: string | null;
}

export type AppointmentStatus =
  | 'pending_confirm'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show';

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
  cancelledBy: 'customer' | 'barber' | 'system' | null;
  cancelReason: string | null;
  source: 'whatsapp' | 'panel';
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
