/**
 * Uygulama genelinde paylaşılan sabitler.
 *
 * ⚠️ Randevu süresi (45 dk) BURADA YOK ve hiçbir yerde sabit olarak yazılmaz.
 * Süre `services.duration_min`, slot adımı `shops.slot_step_min` kolonundan okunur.
 * Bkz. todo.md → "M2 — Slot Motoru".
 */

export const APPOINTMENT_STATUS = {
  PENDING_CONFIRM: 'pending_confirm',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
} as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[keyof typeof APPOINTMENT_STATUS];

/**
 * Bir slotu "dolu" sayan durumlar.
 * Veritabanındaki çakışma kısıtı (EXCLUDE USING gist) da tam olarak bu iki durumu kapsar —
 * ikisi birbiriyle uyumlu kalmalı.
 */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  APPOINTMENT_STATUS.PENDING_CONFIRM,
  APPOINTMENT_STATUS.CONFIRMED,
];

export const CANCELLED_BY = {
  CUSTOMER: 'customer',
  BARBER: 'barber',
  SYSTEM: 'system',
} as const;

export type CancelledBy = (typeof CANCELLED_BY)[keyof typeof CANCELLED_BY];

export const APPOINTMENT_SOURCE = {
  WHATSAPP: 'whatsapp',
  PANEL: 'panel',
} as const;

export type AppointmentSource = (typeof APPOINTMENT_SOURCE)[keyof typeof APPOINTMENT_SOURCE];

export const BARBER_ROLE = {
  ADMIN: 'admin',
  STAFF: 'staff',
} as const;

export type BarberRole = (typeof BARBER_ROLE)[keyof typeof BARBER_ROLE];

/** Türkiye kalıcı olarak UTC+3'tür; 2016'dan beri yaz saati uygulaması yok. */
export const DEFAULT_TIMEZONE = 'Europe/Istanbul';

/** 0 = Pazar ... 6 = Cumartesi (JavaScript `Date.getDay()` ile aynı). */
export const DAY_NAMES_TR = [
  'Pazar',
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
] as const;

export const MONTH_NAMES_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
] as const;
