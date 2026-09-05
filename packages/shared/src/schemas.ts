import { z } from 'zod';
import { normalizePhone } from './phone.js';
import { APPOINTMENT_STATUS, CANCELLED_BY, BARBER_ROLE } from './constants.js';
import { MAX_SERVICES_PER_APPOINTMENT } from './duration.js';

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

// ─── Hizmet seçimi ──────────────────────────────────────

/**
 * Bir randevunun hizmet listesini çözer.
 *
 * ⚠️ Tekil `serviceId` alanı BİLEREK kabul edilmeye devam ediyor.
 *
 * Panel ve müşteri sitesi birer PWA; telefonda önbelleğe alınmış ESKİ bir
 * sürüm, sunucu güncellendikten sonra da bir süre çalışmaya devam edebiliyor
 * (bu daha önce gerçekten yaşandı: eski service worker güncel sürümü ele geçirdi).
 * Eski sürüm tekil `serviceId` gönderiyor. Bu alan kaldırılsaydı, güncelleme
 * anında telefonundaki eski siteyle randevu almaya çalışan müşteri
 * "Geçersiz istek" hatası alırdı.
 */
function hizmetListesiniCoz(
  serviceIds: readonly string[] | undefined,
  serviceId: string | undefined,
  ctx: z.RefinementCtx,
): string[] {
  const secilenler = serviceIds ?? (serviceId ? [serviceId] : []);
  const benzersiz = [...new Set(secilenler)];

  if (benzersiz.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'En az bir hizmet seçilmeli',
      path: ['serviceIds'],
    });
  }

  if (benzersiz.length > MAX_SERVICES_PER_APPOINTMENT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `En fazla ${MAX_SERVICES_PER_APPOINTMENT} hizmet seçebilirsiniz`,
      path: ['serviceIds'],
    });
  }

  return benzersiz;
}

const serviceIdsSchema = z.array(uuidSchema).max(MAX_SERVICES_PER_APPOINTMENT).optional();

// ─── Slot sorgusu ───────────────────────────────────────

/**
 * Boş saat sorgusu.
 *
 * Saat listesi seçilen hizmetlere BAĞLI: hizmet kümesi randevunun süresini
 * belirliyor, süre de hangi başlangıçların sığdığını. Bu yüzden sorguya tek
 * hizmet değil, seçilen hizmetlerin tamamı gidiyor.
 *
 * Sorgu dizesinde dizi taşımanın en dayanıklı yolu virgülle ayırmak:
 * `?serviceIds=<id>,<id>`.
 */
export const slotsQuerySchema = z
  .object({
    barberId: uuidSchema,
    serviceIds: z.string().optional(),
    /** Eski istemciler için — bkz. hizmetListesiniCoz. */
    serviceId: uuidSchema.optional(),
    date: localDateSchema,
  })
  .transform((query, ctx) => {
    const ayrilmis = query.serviceIds
      ? query.serviceIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined;

    // Virgülle gelen kimlikler tek tek doğrulanmalı; dizeyi bölmek
    // doğrulama yapmaz.
    for (const id of ayrilmis ?? []) {
      if (!uuidSchema.safeParse(id).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Geçersiz hizmet kimliği',
          path: ['serviceIds'],
        });
      }
    }

    return {
      barberId: query.barberId,
      date: query.date,
      serviceIds: hizmetListesiniCoz(ayrilmis, query.serviceId, ctx),
    };
  });
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

// ─── Randevu ────────────────────────────────────────────

/**
 * Panelden manuel (walk-in) randevu oluşturma.
 * Telefon opsiyonel — kapıdan gelen müşterinin numarasını vermek istemeyebilir.
 */
export const createAppointmentSchema = z
  .object({
    barberId: uuidSchema,
    /** Birden fazla hizmet seçilebilir: "Saç + Ağda". */
    serviceIds: serviceIdsSchema,
    /** Eski istemciler için — bkz. hizmetListesiniCoz. */
    serviceId: uuidSchema.optional(),
    /** ISO 8601, saat dilimi bilgisi dahil. Örn: 2026-08-12T09:00:00+03:00 */
    startsAt: z.string().datetime({ offset: true }),
    customerName: z.string().trim().min(1, 'Müşteri adı gerekli').max(120),
    customerPhone: phoneSchema.optional(),
    notifyCustomer: z.boolean().optional().default(false),
  })
  .transform((input, ctx) => ({
    ...input,
    serviceIds: hizmetListesiniCoz(input.serviceIds, input.serviceId, ctx),
  }));
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

/**
 * İnternet sitesinden randevu alma.
 *
 * `createAppointmentSchema`'dan iki farkı var ve ikisi de bilinçli:
 *
 *   1. Telefon ZORUNLU. Panelde opsiyonel, çünkü kapıdan gelen müşteri
 *      numarasını vermek zorunda değil ve berber onu zaten görüyor. Siteden
 *      randevu alanı ise berber tanımıyor — numara, randevuyu bir kişiye
 *      bağlayan tek şey.
 *   2. `notifyCustomer` yok. Müşteriye ne gönderileceğine istemci karar
 *      verememeli; site tarafı bunu isteyip sunucuyu mesaj göndermeye
 *      zorlayabilseydi kötüye kullanılırdı.
 */
export const publicBookingSchema = z
  .object({
    barberId: uuidSchema,
    /** Birden fazla hizmet seçilebilir: "Saç + Ağda". */
    serviceIds: serviceIdsSchema,
    /** Eski istemciler için — bkz. hizmetListesiniCoz. */
    serviceId: uuidSchema.optional(),
    /** ISO 8601, saat dilimi bilgisi dahil. */
    startsAt: z.string().datetime({ offset: true }),
    customerName: z.string().trim().min(2, 'Adınızı ve soyadınızı yazın').max(120),
    customerPhone: phoneSchema,
  })
  .transform((input, ctx) => ({
    ...input,
    serviceIds: hizmetListesiniCoz(input.serviceIds, input.serviceId, ctx),
  }));
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

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

// ─── İstatistik ─────────────────────────────────────────

export const statsQuerySchema = z
  .object({
    from: localDateSchema,
    /** Bu gün DAHİL. */
    to: localDateSchema,
    /** Yalnızca admin için anlamlı; staff her zaman kendi verisini görür. */
    barberId: uuidSchema.optional(),
  })
  .refine((d) => d.from <= d.to, {
    message: 'Başlangıç tarihi bitişten sonra olamaz',
    path: ['to'],
  });
export type StatsQuery = z.infer<typeof statsQuerySchema>;

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

/**
 * Berber düzenleme.
 *
 * ⚠️ E-POSTA burada YOK — bilerek. E-posta aynı zamanda giriş kimliği ve
 * `refresh_token` kayıtları o hesaba bağlı; değiştirmek berberin açık
 * oturumlarıyla ilgili ayrı bir karar gerektirir. Ad ve rol düzeltmek ise
 * gündelik bir ihtiyaç ("Fırat" yerine "Fırat Bey" yazılmış gibi).
 *
 * `isActive`: berber SİLİNMEZ, pasife alınır — geçmiş randevuları hangi
 * berbere ait olduğunu kaybetmemeli (bkz. schema.prisma → "Hiçbir şey
 * silinmez").
 */
export const updateBarberSchema = z.object({
  name: z.string().trim().min(1, 'Ad gerekli').max(120),
  role: z.nativeEnum(BARBER_ROLE),
  isActive: z.boolean(),
});
export type UpdateBarberInput = z.infer<typeof updateBarberSchema>;

// ─── Hizmet ─────────────────────────────────────────────

export const upsertServiceSchema = z.object({
  name: z.string().trim().min(1, 'Hizmet adı gerekli').max(80),
  durationMin: z
    .number()
    .int()
    .min(5, 'Süre en az 5 dakika olmalı')
    .max(480, 'Süre en fazla 8 saat olabilir'),
  price: z.number().nonnegative().max(1_000_000).nullable().optional(),
  /**
   * Bu hizmet başka bir hizmetle birlikte seçilirse randevu bir oturum daha
   * uzar (bkz. duration.ts). Lazer için işaretli; diğerleri aynı oturumda
   * yapılabiliyor.
   */
  requiresOwnSlot: z.boolean().optional().default(false),
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
