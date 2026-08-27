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
  /**
   * Bu hizmet, yanında başka bir hizmet varken aynı oturuma sığmaz —
   * randevuya kendi süresini ekler (Lazer). Bkz. @berber/shared → duration.ts.
   */
  requiresOwnSlot?: boolean;
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
  /**
   * Randevunun ANA hizmeti — tek satırlık gösterimlerin geri düşeceği yer.
   * Süreyle ilgisi yok; süre `services` kümesinin tamamından hesaplanıyor.
   */
  service: { id: string; name: string; durationMin: number; price?: string | null };
  /**
   * Randevuda yapılacak hizmetlerin tamamı ("Saç + Ağda").
   *
   * Opsiyonel çünkü telefonda önbellekte kalmış eski panel sürümüyle yeni
   * sunucu bir süre yan yana çalışabiliyor; alan yoksa arayüz ana hizmete
   * düşer, boş ekran göstermez.
   */
  services?: Array<{ id: string; name: string; durationMin: number; price?: string | null }>;
  barber: { id: string; name: string };
  localStartTime?: string;
  localEndTime?: string;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  label: string;
  /**
   * Saati geçmiş boş slot.
   *
   * Panel gün görünümü geçmiş saatleri de gösteriyor (berber sabah kimin
   * geldiğini akşam da görebilmeli), ama onlara randevu YAZILAMAZ.
   */
  isPast?: boolean;
}

export interface WorkingHoursDay {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isWorking: boolean;
}

export interface TimeOff {
  id: string;
  barberId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string;
}

/** Müşteri listesi satırı — `GET /customers` yanıtı. */
export interface CustomerListItem extends Customer {
  blacklistNote: string | null;
  createdAt: string;
}

/** `GET /stats` yanıtı. */
export interface Stats {
  range: { from: string; to: string };
  total: number;
  uniqueCustomers: number;
  byStatus: Record<AppointmentStatus, number>;
  bySource: { whatsapp: number; panel: number };
  byBarber: Array<{ barberId: string; name: string; count: number }>;
}

/** Müşteri detayı — `GET /customers/:id`, randevu geçmişiyle. */
export interface CustomerDetail extends CustomerListItem {
  appointments: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    status: AppointmentStatus;
    service: { id: string; name: string };
    /** Randevunun hizmetlerinin tamamı; eski yanıtlarda bulunmayabilir. */
    services?: Array<{ id: string; name: string }>;
    barber: { id: string; name: string };
  }>;
}

export const STATUS_LABELS_TR: Record<AppointmentStatus, string> = {
  pending_confirm: 'Onay bekliyor',
  confirmed: 'Onaylandı',
  cancelled: 'İptal edildi',
  completed: 'Tamamlandı',
  no_show: 'Gelmedi',
};
