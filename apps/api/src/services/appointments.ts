import {
  APPOINTMENT_STATUS,
  BLOCKING_STATUSES,
  type AppointmentStatus,
  normalizePhone,
} from '@berber/shared';
import { prisma } from '../db/client.js';
import { computeAvailableSlots, isSlotBookable, type Slot } from './slots.js';
import {
  localDayBounds,
  formatLocalTime,
  formatDateTr,
  addMinutes,
  getZonedParts,
} from '../lib/time.js';
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  SlotTakenError,
  isOverlapViolation,
} from '../lib/errors.js';
import { recordAudit, AUDIT_ACTIONS } from './audit.js';
import { logger } from '../lib/logger.js';
import { assertCanAccessBarber, type AuthContext } from '../middleware/auth.js';
import { sendToCustomer } from './whatsapp/messaging.js';

/**
 * Randevu iş mantığı.
 *
 * Slot motoru (slots.ts) saf ve veritabanından bağımsız kalsın diye, veriyi
 * toplayıp ona besleme işi burada yapılıyor.
 *
 * ⚠️ Yetki kontrolü (`assertCanAccessBarber`) route katmanında zaten
 * yapılıyor, ama burada da tekrarlanıyor — `auth` parametresi verildiğinde.
 * İki katmanlı savunma: servis fonksiyonu ileride başka bir yoldan (yeni bir
 * route, bir cron job) çağrılırsa staff/admin ayrımı sessizce atlanmaz.
 * `auth` opsiyonel çünkü chatbot akışı (müşteri tarafı, berber kimliği yok)
 * bu fonksiyonları auth context'i OLMADAN çağırıyor.
 */

// ─────────────────────────────────────────────────────────
// Slot hesabı için veri toplama
// ─────────────────────────────────────────────────────────

interface SlotContext {
  timezone: string;
  slotStepMin: number;
  maxAdvanceDays: number;
  serviceDurationMin: number;
  workingHours: { startTime: string; endTime: string; isWorking: boolean } | null;
  timeOff: Array<{ startsAt: Date; endsAt: Date }>;
  appointments: Array<{ startsAt: Date; endsAt: Date }>;
}

/**
 * Bir berberin belirli bir gündeki müsaitliğini hesaplamak için gereken
 * her şeyi tek seferde toplar.
 *
 * @param excludeAppointmentId Erteleme sırasında randevunun kendisi
 *        "dolu" sayılmamalı; aksi halde kendi saatine ertelenemez.
 */
async function loadSlotContext(
  shopId: string,
  barberId: string,
  serviceId: string,
  date: string,
  excludeAppointmentId?: string,
): Promise<SlotContext> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new NotFoundError('Dükkan bulunamadı');

  const service = await prisma.service.findFirst({
    where: { id: serviceId, shopId },
  });
  if (!service) throw new NotFoundError('Hizmet bulunamadı');
  if (!service.isActive) throw new ValidationError('Bu hizmet artık verilmiyor');

  const barber = await prisma.barber.findFirst({
    where: { id: barberId, shopId },
  });
  if (!barber) throw new NotFoundError('Berber bulunamadı');
  if (!barber.isActive) throw new ValidationError('Bu berber şu anda randevu almıyor');

  const { start: dayStart, end: dayEnd } = localDayBounds(date, shop.timezone);
  const dayOfWeek = getZonedParts(dayStart, shop.timezone).dayOfWeek;

  const [workingHours, timeOff, appointments] = await Promise.all([
    prisma.workingHours.findUnique({
      where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
    }),

    // Berbere özel izinler + tüm dükkanı kapatan izinler
    prisma.timeOff.findMany({
      where: {
        shopId,
        OR: [{ barberId }, { barberId: null }],
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: { startsAt: true, endsAt: true },
    }),

    prisma.appointment.findMany({
      where: {
        barberId,
        status: { in: BLOCKING_STATUSES as AppointmentStatus[] },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  return {
    timezone: shop.timezone,
    slotStepMin: shop.slotStepMin,
    maxAdvanceDays: shop.maxAdvanceDays,
    serviceDurationMin: service.durationMin,
    workingHours: workingHours
      ? {
          startTime: workingHours.startTime,
          endTime: workingHours.endTime,
          isWorking: workingHours.isWorking,
        }
      : null,
    timeOff,
    appointments,
  };
}

export async function getAvailableSlots(
  shopId: string,
  barberId: string,
  serviceId: string,
  date: string,
  now = new Date(),
  auth?: AuthContext,
): Promise<Slot[]> {
  if (auth) assertCanAccessBarber(auth, barberId);

  const ctx = await loadSlotContext(shopId, barberId, serviceId, date);
  return computeAvailableSlots({ ...ctx, date, now });
}

// ─────────────────────────────────────────────────────────
// Randevu oluşturma
// ─────────────────────────────────────────────────────────

export interface CreateAppointmentParams {
  shopId: string;
  barberId: string;
  serviceId: string;
  startsAt: Date;
  customerName: string;
  customerPhone?: string | undefined;
  source: 'whatsapp' | 'panel';
  status?: AppointmentStatus;
  actorId?: string | null;
  auth?: AuthContext;
  /** Panelden walk-in oluşturulurken müşteriye onay mesajı gönderilsin mi? */
  notifyCustomer?: boolean;
}

/**
 * Randevu oluşturur.
 *
 * ⚠️ Slot müsaitlik kontrolü burada yapılıyor ama çakışmaya karşı ASIL
 * güvence veritabanındaki `appointments_no_overlap` kısıtı. Buradaki kontrol
 * kullanıcıya anlamlı hata mesajı vermek için; kısıt ise yarış durumuna karşı.
 * İkisi birlikte gerekiyor.
 */
export async function createAppointment(params: CreateAppointmentParams) {
  const {
    shopId,
    barberId,
    serviceId,
    startsAt,
    customerName,
    customerPhone,
    source,
    status = APPOINTMENT_STATUS.CONFIRMED,
    actorId = null,
    auth,
    notifyCustomer = false,
  } = params;

  if (auth) assertCanAccessBarber(auth, barberId);

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new NotFoundError('Dükkan bulunamadı');

  const service = await prisma.service.findFirst({ where: { id: serviceId, shopId } });
  if (!service) throw new NotFoundError('Hizmet bulunamadı');

  const localDate = formatLocalDateFromInstant(startsAt, shop.timezone);

  // ── Slot gerçekten alınabilir mi? ────────────────────
  const ctx = await loadSlotContext(shopId, barberId, serviceId, localDate);
  const bookable = isSlotBookable(startsAt, { ...ctx, date: localDate, now: new Date() });

  if (!bookable) {
    throw new ConflictError(
      'Seçilen saat müsait değil. Lütfen güncel saatlerden birini seçin.',
      'SLOT_UNAVAILABLE',
    );
  }

  // ── Müşteri kaydı ────────────────────────────────────
  const customer = await findOrCreateCustomer(shopId, customerName, customerPhone);

  if (customer.isBlacklisted) {
    throw new ConflictError('Bu müşteri kara listede.', 'CUSTOMER_BLACKLISTED');
  }

  const endsAt = addMinutes(startsAt, service.durationMin);

  // ── Kayıt ────────────────────────────────────────────
  try {
    const appointment = await prisma.appointment.create({
      data: {
        shopId,
        barberId,
        customerId: customer.id,
        serviceId,
        startsAt,
        endsAt,
        status,
        source,
        confirmDeadline:
          status === APPOINTMENT_STATUS.PENDING_CONFIRM
            ? new Date(Date.now() + shop.confirmTimeoutMin * 60_000)
            : null,
      },
      include: { customer: true, service: true, barber: true },
    });

    await recordAudit({
      shopId,
      actorId,
      action: AUDIT_ACTIONS.APPOINTMENT_CREATE,
      entityType: 'appointment',
      entityId: appointment.id,
      metadata: { source, startsAt: startsAt.toISOString() },
    });

    if (notifyCustomer && appointment.customer.phone) {
      await sendToCustomer(appointment.customerId, {
        text:
          '✅ Randevunuz oluşturuldu!\n\n' +
          `📅 ${formatDateTr(localDate, shop.timezone)}\n` +
          `🕘 ${formatLocalTime(startsAt, shop.timezone)}\n` +
          `💈 ${appointment.barber.name}\n` +
          `✂️ ${appointment.service.name}`,
        template: 'APPOINTMENT_CONFIRMED',
        templateParams: [
          formatDateTr(localDate, shop.timezone),
          formatLocalTime(startsAt, shop.timezone),
          appointment.barber.name,
          appointment.service.name,
        ],
      }).catch((error: unknown) => {
        // Bildirim başarısız olsa da randevu geçerli — sessizce loglanır.
        logger.error({ err: error, appointmentId: appointment.id }, 'Onay mesajı gönderilemedi');
      });
    }

    return appointment;
  } catch (error) {
    // Veritabanı kısıtı devreye girdi: araya başka bir istek girmiş.
    if (isOverlapViolation(error)) {
      logger.info({ barberId, startsAt }, 'Çakışma kısıtı randevuyu engelledi');
      throw new SlotTakenError();
    }
    throw error;
  }
}

/**
 * Telefon varsa mevcut müşteriyle eşleştirir, yoksa yeni kayıt açar.
 *
 * Telefon yoksa (kapıdan gelen, numara vermek istemeyen müşteri) numarasız
 * bir kayıt açılır — eşleştirilecek bir kimlik yok.
 */
async function findOrCreateCustomer(
  shopId: string,
  name: string,
  phone?: string | undefined,
) {
  if (!phone) {
    return prisma.customer.create({ data: { shopId, name, phone: null } });
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new ValidationError('Geçerli bir telefon numarası giriniz');
  }

  const existing = await prisma.customer.findFirst({
    where: { shopId, phone: normalized },
  });

  if (existing) {
    // İsim boşsa doldur, doluysa dokunma — müşteri kendi verdiği ismi korusun
    if (!existing.name && name) {
      return prisma.customer.update({
        where: { id: existing.id },
        data: { name },
      });
    }
    return existing;
  }

  return prisma.customer.create({ data: { shopId, name, phone: normalized } });
}

function formatLocalDateFromInstant(instant: Date, timezone: string): string {
  const { year, month, day } = getZonedParts(instant, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────
// Durum değişiklikleri
// ─────────────────────────────────────────────────────────

async function loadAppointment(shopId: string, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, shopId },
    include: { customer: true, service: true, barber: true },
  });

  if (!appointment) throw new NotFoundError('Randevu bulunamadı');
  return appointment;
}

const FINAL_STATUSES: AppointmentStatus[] = [
  APPOINTMENT_STATUS.CANCELLED,
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.NO_SHOW,
];

function assertNotFinalised(status: AppointmentStatus, action: string): void {
  if (FINAL_STATUSES.includes(status)) {
    throw new ConflictError(
      `Bu randevu zaten sonuçlanmış, ${action} işlemi yapılamaz.`,
      'ALREADY_FINALISED',
    );
  }
}

export async function cancelAppointment(
  shopId: string,
  appointmentId: string,
  cancelledBy: 'customer' | 'barber' | 'system',
  reason?: string,
  actorId?: string | null,
  notifyCustomer = false,
  auth?: AuthContext,
) {
  const appointment = await loadAppointment(shopId, appointmentId);
  if (auth) assertCanAccessBarber(auth, appointment.barberId);
  assertNotFinalised(appointment.status, 'iptal');

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: APPOINTMENT_STATUS.CANCELLED,
      cancelledBy,
      cancelReason: reason ?? null,
      cancelledAt: new Date(),
    },
    include: { customer: true, service: true, barber: true },
  });

  await recordAudit({
    shopId,
    actorId: actorId ?? null,
    action: AUDIT_ACTIONS.APPOINTMENT_CANCEL,
    entityType: 'appointment',
    entityId: appointmentId,
    metadata: { cancelledBy, reason: reason ?? null },
  });

  // Yalnızca berber iptal ettiğinde bildirim anlamlı — müşteri kendi iptal
  // ettiyse (chatbot) zaten biliyor.
  if (notifyCustomer && cancelledBy === 'barber' && updated.customer.phone) {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (shop) {
      await sendToCustomer(updated.customerId, {
        text:
          '❌ Randevunuz iptal edildi.\n\n' +
          `📅 ${formatDateTr(formatLocalDateFromInstant(updated.startsAt, shop.timezone), shop.timezone)} — ` +
          `🕘 ${formatLocalTime(updated.startsAt, shop.timezone)}\n\n` +
          'Özür dileriz. Yeni randevu için bize yazabilirsiniz.',
        template: 'CANCELLED_BY_BARBER',
        templateParams: [
          formatDateTr(formatLocalDateFromInstant(updated.startsAt, shop.timezone), shop.timezone),
          formatLocalTime(updated.startsAt, shop.timezone),
        ],
      }).catch((error: unknown) => {
        logger.error(
          { err: error, appointmentId: updated.id },
          'İptal bildirimi gönderilemedi',
        );
      });
    }
  }

  return updated;
}

/**
 * Müşterinin kendi iptali için ek kural: randevuya çok az kaldıysa
 * chatbot üzerinden iptal edilemez.
 */
export async function assertCustomerCanCancel(
  shopId: string,
  appointmentId: string,
  now = new Date(),
): Promise<void> {
  const [shop, appointment] = await Promise.all([
    prisma.shop.findUnique({ where: { id: shopId } }),
    prisma.appointment.findFirst({ where: { id: appointmentId, shopId } }),
  ]);

  if (!shop) throw new NotFoundError('Dükkan bulunamadı');
  if (!appointment) throw new NotFoundError('Randevu bulunamadı');

  const minutesUntil = (appointment.startsAt.getTime() - now.getTime()) / 60_000;

  if (minutesUntil < shop.cancelCutoffMin) {
    throw new ConflictError(
      `Randevunuza ${shop.cancelCutoffMin} dakikadan az kaldığı için buradan iptal edemiyorsunuz. Lütfen bizi arayın.`,
      'CANCEL_CUTOFF_PASSED',
    );
  }
}

export async function completeAppointment(
  shopId: string,
  appointmentId: string,
  actorId: string,
  auth?: AuthContext,
) {
  const appointment = await loadAppointment(shopId, appointmentId);
  if (auth) assertCanAccessBarber(auth, appointment.barberId);
  assertNotFinalised(appointment.status, 'tamamlandı');

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: APPOINTMENT_STATUS.COMPLETED },
    include: { customer: true, service: true, barber: true },
  });

  await recordAudit({
    shopId,
    actorId,
    action: AUDIT_ACTIONS.APPOINTMENT_COMPLETE,
    entityType: 'appointment',
    entityId: appointmentId,
  });

  return updated;
}

/**
 * Gelmedi olarak işaretler ve müşterinin sayacını artırır.
 *
 * İkisi aynı transaction'da: sayaç artmadan durum değişirse "gelmedi" geçmişi
 * eksik kalır ve kara liste kararı yanlış veriye dayanır.
 */
export async function markNoShow(
  shopId: string,
  appointmentId: string,
  actorId: string,
  auth?: AuthContext,
) {
  const appointment = await loadAppointment(shopId, appointmentId);
  if (auth) assertCanAccessBarber(auth, appointment.barberId);
  assertNotFinalised(appointment.status, 'gelmedi');

  const [updated] = await prisma.$transaction([
    prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: APPOINTMENT_STATUS.NO_SHOW },
      include: { customer: true, service: true, barber: true },
    }),
    prisma.customer.update({
      where: { id: appointment.customerId },
      data: { noShowCount: { increment: 1 } },
    }),
  ]);

  await recordAudit({
    shopId,
    actorId,
    action: AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
    entityType: 'appointment',
    entityId: appointmentId,
    metadata: { customerId: appointment.customerId },
  });

  return updated;
}

export async function rescheduleAppointment(
  shopId: string,
  appointmentId: string,
  newStartsAt: Date,
  actorId?: string | null,
  notifyCustomer = false,
  auth?: AuthContext,
) {
  const appointment = await loadAppointment(shopId, appointmentId);
  if (auth) assertCanAccessBarber(auth, appointment.barberId);
  assertNotFinalised(appointment.status, 'saat değiştirme');

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new NotFoundError('Dükkan bulunamadı');

  const localDate = formatLocalDateFromInstant(newStartsAt, shop.timezone);

  // Randevunun kendisi "dolu" sayılmamalı — kendi saatine yakın bir slota
  // taşınabilmesi gerekiyor.
  const ctx = await loadSlotContext(
    shopId,
    appointment.barberId,
    appointment.serviceId,
    localDate,
    appointmentId,
  );

  if (!isSlotBookable(newStartsAt, { ...ctx, date: localDate, now: new Date() })) {
    throw new ConflictError('Seçilen saat müsait değil.', 'SLOT_UNAVAILABLE');
  }

  const newEndsAt = addMinutes(newStartsAt, appointment.service.durationMin);
  const previousStartsAt = appointment.startsAt;

  try {
    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { startsAt: newStartsAt, endsAt: newEndsAt },
      include: { customer: true, service: true, barber: true },
    });

    await recordAudit({
      shopId,
      actorId: actorId ?? null,
      action: AUDIT_ACTIONS.APPOINTMENT_RESCHEDULE,
      entityType: 'appointment',
      entityId: appointmentId,
      metadata: {
        from: previousStartsAt.toISOString(),
        to: newStartsAt.toISOString(),
      },
    });

    if (notifyCustomer && updated.customer.phone) {
      const previousLocalDate = formatLocalDateFromInstant(previousStartsAt, shop.timezone);
      const newLocalDate = formatLocalDateFromInstant(newStartsAt, shop.timezone);
      const previousLabel = `${formatDateTr(previousLocalDate, shop.timezone)} ${formatLocalTime(previousStartsAt, shop.timezone)}`;
      const newLabel = `${formatDateTr(newLocalDate, shop.timezone)} ${formatLocalTime(newStartsAt, shop.timezone)}`;

      await sendToCustomer(updated.customerId, {
        text:
          '🔄 Randevu saatiniz değişti.\n\n' +
          `Eski: ${previousLabel}\n` +
          `Yeni: ${newLabel}\n\n` +
          'Uygun değilse bize yazabilirsiniz.',
        template: 'RESCHEDULED_BY_BARBER',
        templateParams: [previousLabel, newLabel],
      }).catch((error: unknown) => {
        logger.error(
          { err: error, appointmentId: updated.id },
          'Saat değişikliği bildirimi gönderilemedi',
        );
      });
    }

    return updated;
  } catch (error) {
    if (isOverlapViolation(error)) throw new SlotTakenError();
    throw error;
  }
}

// ─────────────────────────────────────────────────────────
// Listeleme
// ─────────────────────────────────────────────────────────

export interface ListAppointmentsParams {
  shopId: string;
  barberId?: string | undefined;
  date?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: AppointmentStatus | undefined;
  cursor?: string | undefined;
  limit: number;
}

export async function listAppointments(params: ListAppointmentsParams) {
  const shop = await prisma.shop.findUnique({ where: { id: params.shopId } });
  if (!shop) throw new NotFoundError('Dükkan bulunamadı');

  const where: Record<string, unknown> = { shopId: params.shopId };

  if (params.barberId) where.barberId = params.barberId;
  if (params.status) where.status = params.status;

  // Tek gün ya da tarih aralığı
  if (params.date) {
    const { start, end } = localDayBounds(params.date, shop.timezone);
    where.startsAt = { gte: start, lt: end };
  } else if (params.from || params.to) {
    const range: { gte?: Date; lt?: Date } = {};
    if (params.from) range.gte = localDayBounds(params.from, shop.timezone).start;
    if (params.to) range.lt = localDayBounds(params.to, shop.timezone).end;
    where.startsAt = range;
  }

  // Bir fazla çekip "devamı var mı" sorusunu cevaplıyoruz
  const rows = await prisma.appointment.findMany({
    where,
    include: {
      customer: {
        select: { id: true, name: true, phone: true, noShowCount: true, isBlacklisted: true },
      },
      service: { select: { id: true, name: true, durationMin: true } },
      barber: { select: { id: true, name: true } },
    },
    orderBy: { startsAt: 'asc' },
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;

  return {
    items: items.map((a) => ({
      ...a,
      localStartTime: formatLocalTime(a.startsAt, shop.timezone),
      localEndTime: formatLocalTime(a.endsAt, shop.timezone),
    })),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function getAppointment(shopId: string, appointmentId: string, auth?: AuthContext) {
  const appointment = await loadAppointment(shopId, appointmentId);
  if (auth) assertCanAccessBarber(auth, appointment.barberId);
  return appointment;
}
