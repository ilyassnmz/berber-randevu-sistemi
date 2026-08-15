import { z } from 'zod';
import { normalizePhone } from './phone.js';
import { APPOINTMENT_STATUS, CANCELLED_BY, BARBER_ROLE } from './constants.js';

/**
 * API giriş şemaları. Backend doğrulama için, frontend form doğrulaması için
 * aynı şemayı kullanır — iki tarafın kuralları böylece ayrışamaz.
 */

/** Telefon girişini E.164'e çevirir; geçersizse doğrulama hatası verir. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((val, ctx) => {
    const normalized = normalizePhone(val);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Geçerli bir Türkiye cep telefonu numarası giriniz',
      });
      return z.NEVER;
    }
    return normalized;
  });

/** Yerel tarih: YYYY-MM-DD */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG formatında olmalı');

export const uuidSchema = z.string().uuid('Geçersiz kimlik');

// ─── Kimlik doğrulama ───────────────────────────────────

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Geçerli bir e-posta giriniz'),
  password: z.string().min(1, 'Şifre gerekli'),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mevcut şifre gerekli'),
    newPassword: z
      .string()
      .min(10, 'Yeni şifre en az 10 karakter olmalı')
      .max(200, 'Şifre çok uzun'),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'Yeni şifre mevcut şifreyle aynı olamaz',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ─── Slot sorgusu ───────────────────────────────────────

export const slotsQuerySchema = z.object({
  barberId: uuidSchema,
  serviceId: uuidSchema,
  date: localDateSchema,
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

// ─── Randevu ────────────────────────────────────────────

/**
 * Panelden manuel (walk-in) randevu oluşturma.
 * Telefon opsiyonel — kapıdan gelen müşterinin numarasını vermek istemeyebilir.
 */
export const createAppointmentSchema = z.object({
  barberId: uuidSchema,
  serviceId: uuidSchema,
  /** ISO 8601, saat dilimi bilgisi dahil. Örn: 2026-08-12T09:00:00+03:00 */
  startsAt: z.string().datetime({ offset: true }),
  customerName: z.string().trim().min(1, 'Müşteri adı gerekli').max(120),
  customerPhone: phoneSchema.optional(),
  notifyCustomer: z.boolean().optional().default(false),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  notifyCustomer: z.boolean().optional().default(true),
});
export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  notifyCustomer: z.boolean().optional().default(true),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const listAppointmentsQuerySchema = z.object({
  barberId: uuidSchema.optional(),
  date: localDateSchema.optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  status: z.nativeEnum(APPOINTMENT_STATUS).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

// ─── Müşteri ────────────────────────────────────────────

export const blacklistCustomerSchema = z.object({
  reason: z.string().trim().min(1, 'Sebep girilmeli').max(500),
});
export type BlacklistCustomerInput = z.infer<typeof blacklistCustomerSchema>;

export const listCustomersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  blacklistedOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

// ─── Çalışma saatleri / izinler ─────────────────────────

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Saat SS:DD formatında olmalı');

export const workingHoursSchema = z
  .array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: timeStringSchema,
      endTime: timeStringSchema,
      isWorking: z.boolean(),
    }),
  )
  .length(7, 'Haftanın 7 günü de gönderilmeli')
  .superRefine((days, ctx) => {
    const seen = new Set<number>();
    for (const [i, day] of days.entries()) {
      if (seen.has(day.dayOfWeek)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Aynı gün birden fazla kez gönderildi',
          path: [i, 'dayOfWeek'],
        });
      }
      seen.add(day.dayOfWeek);

      if (day.isWorking && day.startTime >= day.endTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Kapanış saati açılış saatinden sonra olmalı',
          path: [i, 'endTime'],
        });
      }
    }
  });
export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;

export const createTimeOffSchema = z
  .object({
    /** null = tüm dükkan kapalı */
    barberId: uuidSchema.nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1, 'Sebep girilmeli').max(200),
  })
  .refine((d) => new Date(d.startsAt) < new Date(d.endsAt), {
    message: 'Bitiş zamanı başlangıçtan sonra olmalı',
    path: ['endsAt'],
  });
export type CreateTimeOffInput = z.infer<typeof createTimeOffSchema>;

// ─── Berber ─────────────────────────────────────────────

export const createBarberSchema = z.object({
  name: z.string().trim().min(1, 'Ad gerekli').max(120),
  email: z.string().trim().toLowerCase().email('Geçerli bir e-posta giriniz'),
  role: z.nativeEnum(BARBER_ROLE).default(BARBER_ROLE.STAFF),
});
export type CreateBarberInput = z.infer<typeof createBarberSchema>;

// ─── Hizmet ─────────────────────────────────────────────

export const upsertServiceSchema = z.object({
  name: z.string().trim().min(1, 'Hizmet adı gerekli').max(80),
  durationMin: z
    .number()
    .int()
    .min(5, 'Süre en az 5 dakika olmalı')
    .max(480, 'Süre en fazla 8 saat olabilir'),
  price: z.number().nonnegative().max(1_000_000).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpsertServiceInput = z.infer<typeof upsertServiceSchema>;

// ─── Yanıt tipleri ──────────────────────────────────────

export interface SlotDto {
  /** ISO 8601, saat dilimi dahil */
  startsAt: string;
  endsAt: string;
  /** Yerel saat gösterimi, örn. "09:00" */
  label: string;
}

export const APPOINTMENT_STATUS_LABELS_TR: Record<string, string> = {
  [APPOINTMENT_STATUS.PENDING_CONFIRM]: 'Onay bekliyor',
  [APPOINTMENT_STATUS.CONFIRMED]: 'Onaylandı',
  [APPOINTMENT_STATUS.CANCELLED]: 'İptal edildi',
  [APPOINTMENT_STATUS.COMPLETED]: 'Tamamlandı',
  [APPOINTMENT_STATUS.NO_SHOW]: 'Gelmedi',
};

export const CANCELLED_BY_LABELS_TR: Record<string, string> = {
  [CANCELLED_BY.CUSTOMER]: 'Müşteri iptal etti',
  [CANCELLED_BY.BARBER]: 'Berber iptal etti',
  [CANCELLED_BY.SYSTEM]: 'Sistem iptal etti',
};
