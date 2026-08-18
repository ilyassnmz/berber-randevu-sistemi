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

/**
 * İleri tarih sınırı (`shops.maxAdvanceDays`) kime uygulanacak?
 *
 * Müşteri en fazla 1 hafta sonrasına randevu alabilir — takvimin aylar öncesinden
 * dolmasını engellemek için. Ama BERBER bu sınıra tabi değil: düğün gibi ileri
 * tarihli bir talebi telefonla alıp panelden işleyebilmesi gerekiyor.
 *
 * Bu yüzden sınır dükkan ayarında tek bir sayı olarak durmakla birlikte, slot
 * hesabına kimin adına girildiğine göre uygulanıyor.
 */
export type BookingActor = 'customer' | 'barber';

/**
 * Berber için "sınır yok" demenin yolu.
 *
 * `maxAdvanceDays`'i opsiyonel yapıp `undefined` kontrolü eklemek yerine büyük
 * bir sayı veriliyor: slot motoru (slots.ts) saf ve tek kurallı kalsın diye.
 * 10 yıl, pratikte sınırsız.
 */
const NO_ADVANCE_LIMIT_DAYS = 3650;

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
 * @param opts.excludeAppointmentId Erteleme sırasında randevunun kendisi
 *        "dolu" sayılmamalı; aksi halde kendi saatine ertelenemez.
 * @param opts.actor İleri tarih sınırının uygulanıp uygulanmayacağını belirler.
 *        Varsayılan BİLEREK 'customer': sınırlı olan taraf varsayılan olsun,
 *        yeni bir çağıran eklendiğinde sınır sessizce atlanmasın.
 */
async function loadSlotContext(
  shopId: string,
  barberId: string,
  serviceId: string,
  date: string,
  opts: { excludeAppointmentId?: string; actor?: BookingActor } = {},
): Promise<SlotContext> {
  const { excludeAppointmentId, actor = 'customer' } = opts;
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
    maxAdvanceDays: actor === 'barber' ? NO_ADVANCE_LIMIT_DAYS : shop.maxAdvanceDays,
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

  // `auth` yalnızca panelden gelen isteklerde dolu olur — yani soran berberdir
  // ve ileri tarih sınırına tabi değildir. Müşteri tarafı (internet sitesi ve
  // chatbot) auth göndermez; onlar için sınır geçerli.
  const actor: BookingActor = auth ? 'barber' : 'customer';

  const ctx = await loadSlotContext(shopId, barberId, serviceId, date, { actor });
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
  /** 'web' = internet sitesi, 'panel' = berberin elle girdiği walk-in. */
  source: 'whatsapp' | 'panel' | 'web';
  status?: AppointmentStatus;
  actorId?: string | null;
  auth?: AuthContext;
  /** Panelden walk-in oluşturulurken müşteriye onay mesajı gönderilsin mi? */
  notifyCustomer?: boolean;
  /**
   * Siteden alınan randevularda, müşterinin randevusunu daha sonra görüntüleyip
   * iptal edebilmesi için üretilen gizli anahtar. Yalnızca `web` kaynağında dolu.
   */
  publicToken?: string | undefined;
  /**
   * İstemci IP'sinin özeti (bkz. lib/client-hash.ts). Kötüye kullanım
   * tespiti ve toplu iptal için; yalnızca site kaynaklı randevularda dolu.
   */
  clientHash?: string | null | undefined;
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
    publicToken,
    clientHash,
  } = params;

  if (auth) assertCanAccessBarber(auth, barberId);

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new NotFoundError('Dükkan bulunamadı');

  const service = await prisma.service.findFirst({ where: { id: serviceId, shopId } });
  if (!service) throw new NotFoundError('Hizmet bulunamadı');

  const localDate = formatLocalDateFromInstant(startsAt, shop.timezone);

  // ── Slot gerçekten alınabilir mi? ────────────────────
  // İleri tarih sınırı yalnızca müşteri tarafına uygulanır; panelden randevu
  // giren berber istediği tarihe girebilir (bkz. BookingActor).
  const actor: BookingActor = source === 'panel' ? 'barber' : 'customer';

  const ctx = await loadSlotContext(shopId, barberId, serviceId, localDate, { actor });
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

  // ── Aynı güne ikinci randevu ─────────────────────────
  //
  // Bu kural eskiden yalnızca chatbot akışının içindeydi. Randevu almanın
  // ikinci bir yolu (internet sitesi) açıldığı an oradan kaçak veriyordu;
  // bu yüzden randevu oluşturmanın TEK ortak noktasına taşındı.
  //
  // Yalnızca müşteri tarafına uygulanır: berber, aynı müşteriye aynı gün
  // içinde ikinci bir randevu vermek isteyebilir (örn. iki ayrı hizmet).
  //
  // ⚠️ Gün sınırı YEREL güne göre hesaplanıyor. Eski chatbot kodu UTC gününü
  // kullanıyordu; Türkiye UTC+3 olduğu için gecenin ilk üç saatindeki
  // randevular yanlış güne düşüyordu.
  if (actor === 'customer') {
    const { start: dayStart, end: dayEnd } = localDayBounds(localDate, shop.timezone);

    const sameDay = await prisma.appointment.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: [APPOINTMENT_STATUS.PENDING_CONFIRM, APPOINTMENT_STATUS.CONFIRMED],
        },
        startsAt: { gte: dayStart, lt: dayEnd },
      },
    });

    if (sameDay) {
      throw new ConflictError(
        'Bu güne zaten bir randevunuz var. Aynı güne ikinci randevu alınamıyor.',
        'DUPLICATE_SAME_DAY',
      );
    }
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
        publicToken: publicToken ?? null,
        clientHash: clientHash ?? null,
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
    // Randevuda verilen isim, kayıtlı isimden farklıysa GÜNCELLENİR.
    //
    // ⚠️ Eskiden tam tersiydi: isim doluysa dokunulmuyordu. O davranış
    // chatbot dönemine aitti — müşteri adını bir kez söylüyordu ve berberin
    // sonradan girdiği kısaltmanın onu ezmemesi isteniyordu.
    //
    // Randevu siteye taşınınca bu kural hataya dönüştü: müşteri her randevuda
    // adını KENDİSİ yazıyor, ama yazdığı isim sessizce çöpe gidiyor ve
    // panelde eski isim görünüyordu. İlk seferde yanlış yazan biri adını bir
    // daha asla düzeltemiyordu; aynı numarayı kullanan iki kişi (eş, kardeş)
    // de hep ilkinin adıyla görünüyordu.
    //
    // Artık en son verilen isim geçerli: müşterinin kendini nasıl tanıttığı
    // en güncel bilgidir ve berberin ekranda gördüğü isim, müşterinin az önce
    // yazdığı isimle aynı olmalıdır.
    if (name && name !== existing.name) {
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

/**
 * Chatbot'ta "Onayla" ile pending_confirm → confirmed geçişi.
 *
 * Randevu, özet ekranı gösterilirken (showConfirmation) zaten pending_confirm
 * olarak rezerve edilmiş oluyor — burada sadece onay yazılıyor. Süresi
 * dolmuşsa (confirmDeadline geçmiş) expirePendingAppointments cron'u zaten
 * iptal etmiştir; bu durumda NOT_PENDING hatası döner.
 */
export async function confirmPendingAppointment(shopId: string, appointmentId: string) {
  const appointment = await loadAppointment(shopId, appointmentId);

  if (appointment.status !== APPOINTMENT_STATUS.PENDING_CONFIRM) {
    throw new ConflictError(
      'Bu randevunun onay süresi dolmuş ya da zaten işlenmiş.',
      'NOT_PENDING',
    );
  }

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: APPOINTMENT_STATUS.CONFIRMED, confirmDeadline: null },
    include: { customer: true, service: true, barber: true },
  });

  await recordAudit({
    shopId,
    actorId: null,
    action: AUDIT_ACTIONS.APPOINTMENT_CONFIRM,
    entityType: 'appointment',
    entityId: appointmentId,
  });

  return updated;
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

  const [updated, updatedCustomer] = await prisma.$transaction([
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

  // todo.md M6 "Kötüye Kullanım Önlemleri": 3. no-show'da uyarı mesajı.
  // Yalnızca eşiğe TAM ulaşıldığında gönderilir (=== 3) — her sonraki
  // no-show'da tekrar tekrar uyarı gitmesin diye.
  if (updatedCustomer.noShowCount === 3) {
    await sendToCustomer(appointment.customerId, {
      text:
        'Randevularınıza gelmediğinizi fark ettik ⚠️\n\n' +
        'Son 3 randevunuza gelmediniz. Lütfen yalnızca gelebileceğiniz ' +
        'zamanlarda randevu alın — aksi halde yeni randevu alımınız kısıtlanabilir.',
      template: 'NO_SHOW_WARNING',
      templateParams: ['3'],
    }).catch((error: unknown) => {
      logger.error({ err: error, customerId: appointment.customerId }, 'Gelmedi uyarısı gönderilemedi');
    });
  }

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
  // Erteleme yalnızca panelden yapılıyor (chatbot ve site ertelemiyor), yani
  // işlemi yapan berber — ileri tarih sınırına tabi değil.
  const ctx = await loadSlotContext(
    shopId,
    appointment.barberId,
    appointment.serviceId,
    localDate,
    { excludeAppointmentId: appointmentId, actor: 'barber' },
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

/**
 * Aynı cihazdan gelen GELECEK randevuları birlikte bulur.
 *
 * Sahte numaralarla takvim doldurma girişiminde berberin karşısındaki sorun
 * şu: randevular farklı isimler ve farklı numaralarla, farklı günlere
 * dağılmış durumda. Tek tek bulup iptal etmek dakikalar sürüyor ve biri
 * gözden kaçıyor. Ortak nokta yalnızca cihaz özeti.
 *
 * Yalnızca GELECEK ve iptal edilmemiş randevular döner — geçmişi temizlemek
 * bu aracın işi değil.
 */
export async function findSiblingAppointments(
  shopId: string,
  appointmentId: string,
  auth?: AuthContext,
) {
  const appointment = await loadAppointment(shopId, appointmentId);
  if (auth) assertCanAccessBarber(auth, appointment.barberId);

  // Cihaz özeti yoksa (panelden girilmiş ya da eski kayıt) kardeş de yok.
  if (!appointment.clientHash) return [];

  return prisma.appointment.findMany({
    where: {
      shopId,
      clientHash: appointment.clientHash,
      startsAt: { gte: new Date() },
      status: { in: BLOCKING_STATUSES as AppointmentStatus[] },
      // staff yalnızca kendi randevularına dokunabilir; admin hepsine.
      ...(auth && auth.role !== 'admin' ? { barberId: auth.barberId } : {}),
    },
    include: { customer: true, service: true, barber: true },
    orderBy: { startsAt: 'asc' },
  });
}

/**
 * Aynı cihazdan gelen gelecek randevuların TAMAMINI iptal eder.
 *
 * Her biri normal iptal yolundan geçiyor: durum değişikliği, denetim kaydı ve
 * saatin serbest kalması aynı şekilde işliyor. Toplu olması, kuralların
 * atlanacağı anlamına gelmiyor.
 */
export async function cancelSiblingAppointments(
  shopId: string,
  appointmentId: string,
  actorId: string,
  auth?: AuthContext,
) {
  const kardesler = await findSiblingAppointments(shopId, appointmentId, auth);

  let iptalEdilen = 0;
  for (const k of kardesler) {
    await cancelAppointment(
      shopId,
      k.id,
      'barber',
      'Aynı cihazdan toplu iptal (kötüye kullanım şüphesi)',
      actorId,
      false, // müşteriye bildirim GÖNDERİLMEZ: numaralar zaten sahte olabilir
      auth,
    );
    iptalEdilen += 1;
  }

  logger.warn({ shopId, appointmentId, iptalEdilen }, 'Aynı cihazdan toplu randevu iptali');

  return { cancelled: iptalEdilen };
}
