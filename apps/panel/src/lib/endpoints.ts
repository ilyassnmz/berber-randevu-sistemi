import { apiRequest } from './api';
import type {
  Appointment,
  AuthBarber,
  Barber,
  Service,
  Slot,
  AppointmentStatus,
  WorkingHoursDay,
  TimeOff,
  BarberRole,
  CustomerListItem,
  CustomerDetail,
  Stats,
} from './types';

// ─── Auth ───────────────────────────────────────────────

export function login(email: string, password: string) {
  return apiRequest<{ accessToken: string; barber: AuthBarber }>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export function logout() {
  return apiRequest<{ ok: true }>('/auth/logout', { method: 'POST' });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiRequest<{ ok: true; message: string }>('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}

// ─── Berberler / hizmetler ──────────────────────────────

export function fetchBarbers() {
  return apiRequest<{ barbers: Barber[] }>('/barbers');
}

export function fetchServices() {
  return apiRequest<{ services: Service[] }>('/services');
}

export function updateService(
  id: string,
  input: { name: string; durationMin: number; price: number | null; isActive?: boolean },
) {
  return apiRequest<{ service: Service }>(`/services/${id}`, { method: 'PUT', body: input });
}

// ─── Randevular ─────────────────────────────────────────

export function fetchAppointments(params: {
  barberId?: string;
  date?: string;
  /** `date` yerine tarih ARALIĞI. Yaklaşan randevu şeridi bunu kullanıyor. */
  from?: string;
  to?: string;
  status?: AppointmentStatus;
}) {
  return apiRequest<{ items: Appointment[]; nextCursor: string | null }>('/appointments', {
    query: params,
  });
}

export function fetchSlots(params: { barberId: string; serviceId: string; date: string }) {
  return apiRequest<{ slots: Slot[] }>('/appointments/slots', { query: params });
}

export function createAppointment(input: {
  barberId: string;
  serviceId: string;
  startsAt: string;
  customerName: string;
  customerPhone?: string;
}) {
  return apiRequest<{ appointment: Appointment }>('/appointments', {
    method: 'POST',
    body: input,
  });
}

export function cancelAppointment(id: string, reason?: string) {
  return apiRequest<{ appointment: Appointment }>(`/appointments/${id}/cancel`, {
    method: 'POST',
    body: { reason },
  });
}

export function completeAppointment(id: string) {
  return apiRequest<{ appointment: Appointment }>(`/appointments/${id}/complete`, {
    method: 'POST',
  });
}

export function markNoShow(id: string) {
  return apiRequest<{ appointment: Appointment }>(`/appointments/${id}/no-show`, {
    method: 'POST',
  });
}

export function rescheduleAppointment(id: string, startsAt: string) {
  return apiRequest<{ appointment: Appointment }>(`/appointments/${id}/reschedule`, {
    method: 'POST',
    body: { startsAt },
  });
}

// ─── Berber yönetimi ─────────────────────────────────────

export function fetchWorkingHours(barberId: string) {
  return apiRequest<{ workingHours: WorkingHoursDay[] }>(`/barbers/${barberId}/working-hours`);
}

export function updateWorkingHours(barberId: string, days: WorkingHoursDay[]) {
  return apiRequest<{ workingHours: WorkingHoursDay[] }>(`/barbers/${barberId}/working-hours`, {
    method: 'PUT',
    body: days,
  });
}

export function fetchTimeOff(barberId: string) {
  return apiRequest<{ timeOff: TimeOff[] }>(`/barbers/${barberId}/time-off`);
}

export function createTimeOff(
  barberId: string,
  input: { startsAt: string; endsAt: string; reason: string },
) {
  return apiRequest<{ timeOff: TimeOff }>(`/barbers/${barberId}/time-off`, {
    method: 'POST',
    body: input,
  });
}

export function deleteTimeOff(timeOffId: string) {
  return apiRequest<void>(`/barbers/time-off/${timeOffId}`, { method: 'DELETE' });
}

export function createBarber(input: { name: string; email: string; role: BarberRole }) {
  return apiRequest<{ barber: Barber & { email: string }; password: string }>('/barbers', {
    method: 'POST',
    body: input,
  });
}

// ─── Müşteri ─────────────────────────────────────────────

export function blacklistCustomer(customerId: string, reason: string) {
  return apiRequest<{ customer: unknown }>(`/customers/${customerId}/blacklist`, {
    method: 'PUT',
    body: { reason },
  });
}

export function unblacklistCustomer(customerId: string) {
  return apiRequest<{ customer: unknown }>(`/customers/${customerId}/blacklist`, {
    method: 'DELETE',
  });
}

export function fetchCustomers(params: {
  search?: string;
  blacklistedOnly?: boolean;
  cursor?: string;
  limit?: number;
}) {
  return apiRequest<{ items: CustomerListItem[]; nextCursor: string | null }>('/customers', {
    query: params,
  });
}

export function fetchStats(params: { from: string; to: string; barberId?: string }) {
  return apiRequest<Stats>('/stats', { query: params });
}

export function fetchCustomer(customerId: string) {
  return apiRequest<{ customer: CustomerDetail }>(`/customers/${customerId}`);
}

/**
 * Aynı cihazdan gelen diğer gelecek randevular.
 *
 * Sahte numaralarla takvim doldurma girişiminde randevular farklı isim ve
 * numaralarla, farklı günlere dağılmış oluyor; tek ortak noktaları cihaz.
 */
export function fetchSiblingAppointments(appointmentId: string) {
  return apiRequest<{
    items: Array<{
      id: string;
      startsAt: string;
      customerName: string | null;
      barberName: string;
      serviceName: string;
    }>;
  }>(`/appointments/${appointmentId}/siblings`);
}

/** Aynı cihazdan gelen gelecek randevuların tamamını iptal eder. */
export function cancelSiblingAppointments(appointmentId: string) {
  return apiRequest<{ cancelled: number }>(`/appointments/${appointmentId}/cancel-siblings`, {
    method: 'POST',
  });
}

/** Yeni hizmet ekler (yalnızca admin). Müşteri sitesinde anında görünür. */
export function createService(input: {
  name: string;
  durationMin: number;
  price: number | null;
}) {
  return apiRequest<{ service: Service }>('/services', { method: 'POST', body: input });
}

/**
 * Hizmeti kaldırır (yalnızca admin).
 *
 * `mode` sunucudan geliyor: hiç kullanılmamış hizmet gerçekten silinir
 * ('deleted'), randevusu olan gizlenir ('hidden') — geçmiş randevularda
 * hizmet adı okunabilir kalsın diye.
 */
export function deleteService(id: string) {
  return apiRequest<{ mode: 'deleted' | 'hidden'; appointmentCount: number }>(`/services/${id}`, {
    method: 'DELETE',
  });
}

// ─── Bildirimler ─────────────────────────────────────────

export function fetchPushKey() {
  return apiRequest<{ publicKey: string | null; enabled: boolean }>('/push/key');
}

export function subscribePush(subscription: PushSubscriptionJSON) {
  return apiRequest<{ ok: true }>('/push/subscribe', { method: 'POST', body: subscription });
}

export function unsubscribePush(endpoint: string) {
  return apiRequest<{ ok: true }>('/push/unsubscribe', { method: 'POST', body: { endpoint } });
}
