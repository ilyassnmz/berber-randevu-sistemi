import { apiRequest } from './api';
import type { Appointment, AuthBarber, Barber, Service, Slot, AppointmentStatus } from './types';

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

// ─── Randevular ─────────────────────────────────────────

export function fetchAppointments(params: {
  barberId?: string;
  date?: string;
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

// ─── Müşteri ─────────────────────────────────────────────

export function blacklistCustomer(customerId: string, reason: string) {
  return apiRequest<{ customer: unknown }>(`/customers/${customerId}/blacklist`, {
    method: 'PUT',
    body: { reason },
  });
}
