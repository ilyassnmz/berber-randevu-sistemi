import { APPOINTMENT_STATUS, maskPhone } from '@berber/shared';
import { prisma } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import type { InboundMessage } from '../whatsapp/payload.js';
import { replyToCustomer, touchInbound } from '../whatsapp/messaging.js';
import type { ReplyButton, ListRow } from '../whatsapp/client.js';
import {
  getAvailableSlots,
  createAppointment,
  cancelAppointment,
  confirmPendingAppointment,
  assertCustomerCanCancel,
} from '../appointments.js';
import { getZonedParts, formatLocalTime, parseDateString, formatDateTr } from '../../lib/time.js';
import { shouldSilence } from './spam-guard.js';
import { SlotTakenError, ConflictError } from '../../lib/errors.js';
import {
  CHAT_STATE,
  ACTION,
  PREFIX,
  GLOBAL_COMMANDS,
  SESSION_TTL_MIN,
  MAX_INVALID_INPUTS,
  matchesCommand,
  normalizeTurkish,
  type ChatState,
  type ChatContext,
} from './states.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  CHATBOT
 * ══════════════════════════════════════════════════════════════════
 *
 * Akış (todo.md → "M6 — Chatbot"):
 *
 *   Ana menü → [ad sorma*] → berber → tarih → saat → hizmet → onay
 *   * yalnızca ilk kez gelen müşteriye
 *
 * Butonlar (interactive messages) kullanılıyor, "1 yazın" değil. Müşteri yine
 * de metin yazarsa anlaşılmaya çalışılıyor.
 */

const SLOTS_PER_PAGE = 9; // 10. satır "diğer saatler" için ayrılıyor

interface SessionCustomer {
  id: string;
  shopId: string;
  phone: string | null;
  name: string | null;
  optedOut: boolean;
  isBlacklisted: boolean;
  lastInboundAt: Date | null;
}

/**
 * Mesajın hangi dükkana ait olduğunu çözer.
 *
 * Meta her webhook'ta mesajın geldiği numaranın kimliğini gönderiyor; doğru
 * eşleme bunun üzerinden yapılır. Eşleşme yoksa ve sistemde tek dükkan varsa
 * ona düşülür — tek dükkanlı kurulumda `whatsappPhoneId` doldurulmamış olabilir.
 */
export async function resolveShop(phoneNumberId: string | null) {
  if (phoneNumberId) {
    const matched = await prisma.shop.findFirst({
      where: { whatsappPhoneId: phoneNumberId, isActive: true },
    });
    if (matched) return matched;
  }

  const activeShops = await prisma.shop.findMany({ where: { isActive: true }, take: 2 });

  if (activeShops.length === 1) return activeShops[0]!;

  if (activeShops.length > 1) {
    logger.error(
      { phoneNumberId },
      'Birden fazla aktif dükkan var ve numara eşleşmedi — mesaj yönlendirilemedi',
    );
  }
  return null;
}

export async function handleInboundMessage(
  message: InboundMessage,
  shopOverride?: {
    id: string;
    timezone: string;
    contactPhone: string | null;
    cancelCutoffMin: number;
    confirmTimeoutMin: number;
  },
): Promise<void> {
  const shop = shopOverride ?? (await resolveShop(message.phoneNumberId));

  if (!shop) {
    logger.error('Dükkan çözümlenemedi — mesaj işlenemedi');
    return;
  }

  const customer = await findOrCreateCustomer(shop.id, message);

  // ── Spam koruması (bkz. spam-guard.ts eşik gerekçesi) ─
  // Opt-out'tan bile önce kontrol edilir — sel gibi gelen mesajlar hiçbir
  // DB yazması/WhatsApp isteği tetiklemeden burada durur.
  if (await shouldSilence(customer.id)) {
    logger.warn({ phone: maskPhone(message.from) }, 'Spam koruması: mesaj sessizce atlandı');
    return;
  }

  // ── Opt-out: "DUR" diyene hiçbir şey gönderilmez ─────
  if (matchesCommand(message.text, GLOBAL_COMMANDS.OPT_OUT)) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { optedOut: true },
    });
    // Onay mesajı opt-out'tan ÖNCEki durumla gönderilir; Meta bunu bekler.
    await replyToCustomer(
      { ...customer, optedOut: false },
      'Mesaj almayı durdurdunuz. Tekrar randevu almak isterseniz bize yazmanız yeterli. 👋',
    );
    return;
  }

  if (customer.optedOut) {
    // Yazdıysa geri dönmek istiyordur — aboneliği yeniden açıyoruz.
    await prisma.customer.update({
      where: { id: customer.id },
      data: { optedOut: false },
    });
    customer.optedOut = false;
  }

  await touchInbound(customer.id);
  customer.lastInboundAt = new Date();

  // ── Kara liste ───────────────────────────────────────
  if (customer.isBlacklisted) {
    await replyToCustomer(
      customer,
      'Üzgünüz, şu anda randevu alamıyorsunuz. Bilgi için lütfen bizi arayın.' +
        (shop.contactPhone ? `\n📞 ${shop.contactPhone}` : ''),
    );
    return;
  }

  // ── Desteklenmeyen mesaj türü ────────────────────────
  if (message.unsupportedType) {
    await replyToCustomer(
      customer,
      'Şu an sadece yazılı mesajları anlayabiliyorum 😅 Randevu için aşağıdaki menüyü kullanabilirsiniz.',
      { buttons: mainMenuButtons() },
    );
    return;
  }

  const session = await loadSession(shop.id, customer.phone ?? message.from);

  // ── Global komutlar ──────────────────────────────────
  if (matchesCommand(message.text, GLOBAL_COMMANDS.MENU)) {
    await showMainMenu(customer, session.id);
    return;
  }

  await dispatch({
    shop,
    customer,
    sessionId: session.id,
    state: session.state as ChatState,
    context: session.context as ChatContext,
    invalidInputCount: session.invalidInputCount,
    text: message.text,
  });
}

// ─────────────────────────────────────────────────────────
// Müşteri ve oturum
// ─────────────────────────────────────────────────────────

async function findOrCreateCustomer(
  shopId: string,
  message: InboundMessage,
): Promise<SessionCustomer> {
  const existing = await prisma.customer.findFirst({
    where: { shopId, phone: message.from },
  });

  if (existing) return existing as SessionCustomer;

  logger.info({ phone: maskPhone(message.from) }, 'Yeni müşteri kaydı');

  return (await prisma.customer.create({
    data: {
      shopId,
      phone: message.from,
      // WhatsApp profil adını başlangıç değeri yapmıyoruz — müşteriye kendi
      // adını soruyoruz. Profil adları çoğu zaman takma ad oluyor.
      name: null,
      consentAt: new Date(),
    },
  })) as SessionCustomer;
}

async function loadSession(shopId: string, phone: string) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MIN * 60_000);

  const existing = await prisma.chatSession.findUnique({ where: { phone } });

  // Süresi dolmuşsa sıfırdan başlat
  if (existing && existing.expiresAt < new Date()) {
    return prisma.chatSession.update({
      where: { phone },
      data: {
        state: CHAT_STATE.IDLE,
        context: {},
        invalidInputCount: 0,
        lastMessageAt: new Date(),
        expiresAt,
      },
    });
  }

  if (existing) {
    return prisma.chatSession.update({
      where: { phone },
      data: { lastMessageAt: new Date(), expiresAt },
    });
  }

  return prisma.chatSession.create({
    data: { shopId, phone, state: CHAT_STATE.IDLE, context: {}, expiresAt },
  });
}

async function setSession(
  sessionId: string,
  state: ChatState,
  context: ChatContext,
  invalidInputCount = 0,
): Promise<void> {
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { state, context: context as object, invalidInputCount },
  });
}

// ─────────────────────────────────────────────────────────
// Dağıtıcı
// ─────────────────────────────────────────────────────────

interface DispatchArgs {
  shop: {
    id: string;
    timezone: string;
    contactPhone: string | null;
    cancelCutoffMin: number;
    confirmTimeoutMin: number;
  };
  customer: SessionCustomer;
  sessionId: string;
  state: ChatState;
  context: ChatContext;
  invalidInputCount: number;
  text: string;
}

async function dispatch(args: DispatchArgs): Promise<void> {
  const { state } = args;

  switch (state) {
    case CHAT_STATE.IDLE:
      return handleIdle(args);
    case CHAT_STATE.MAIN_MENU:
      return handleMainMenu(args);
    case CHAT_STATE.ASK_NAME:
      return handleAskName(args);
    case CHAT_STATE.SELECT_BARBER:
      return handleSelectBarber(args);
    case CHAT_STATE.SELECT_DATE:
      return handleSelectDate(args);
    case CHAT_STATE.ASK_CUSTOM_DATE:
      return handleCustomDate(args);
    case CHAT_STATE.SELECT_TIME:
      return handleSelectTime(args);
    case CHAT_STATE.SELECT_SERVICE:
      return handleSelectService(args);
    case CHAT_STATE.CONFIRM:
      return handleConfirm(args);
    case CHAT_STATE.SELECT_CANCEL_TARGET:
      return handleSelectCancelTarget(args);
    case CHAT_STATE.CONFIRM_CANCEL:
      return handleConfirmCancel(args);
    default:
      return showMainMenu(args.customer, args.sessionId);
  }
}

// ─────────────────────────────────────────────────────────
// Durum işleyicileri
// ─────────────────────────────────────────────────────────

function mainMenuButtons(): ReplyButton[] {
  return [
    { id: ACTION.BOOK, title: 'Randevu Al' },
    { id: ACTION.MY_APPOINTMENTS, title: 'Randevularım' },
    { id: ACTION.CANCEL, title: 'İptal Et' },
  ];
}

async function showMainMenu(customer: SessionCustomer, sessionId: string): Promise<void> {
  const greeting = customer.name ? `Merhaba ${customer.name}! 👋` : 'Merhaba! 👋';

  const consentLine = customer.name
    ? ''
    : '\n\n_Kişisel verileriniz yalnızca randevu yönetimi için işlenir._';

  await replyToCustomer(
    customer,
    `${greeting}\nÖzdede Hair Studio'ya hoş geldiniz 💈\n\nSize nasıl yardımcı olabiliriz?${consentLine}`,
    { buttons: mainMenuButtons() },
  );

  await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
}

async function handleIdle(args: DispatchArgs): Promise<void> {
  return showMainMenu(args.customer, args.sessionId);
}

async function handleMainMenu(args: DispatchArgs): Promise<void> {
  const { text, customer, sessionId } = args;
  const normalized = normalizeTurkish(text);

  const wantsBooking =
    text === ACTION.BOOK || normalized === '1' || normalized.includes('randevu al');
  const wantsList =
    text === ACTION.MY_APPOINTMENTS || normalized === '2' || normalized.includes('randevular');
  const wantsCancel =
    text === ACTION.CANCEL || normalized === '3' || normalized.includes('iptal');

  if (wantsBooking) {
    // Adı bilmiyorsak önce onu soralım
    if (!customer.name) {
      await replyToCustomer(customer, 'Sizi tanıyalım — adınızı ve soyadınızı yazar mısınız?');
      await setSession(sessionId, CHAT_STATE.ASK_NAME, {});
      return;
    }
    return askBarber(args);
  }

  if (wantsList) return showMyAppointments(args);
  if (wantsCancel) return startCancelFlow(args);

  // Selamlama ya da anlaşılmayan mesaj
  if (matchesCommand(text, GLOBAL_COMMANDS.GREETING)) {
    return showMainMenu(customer, sessionId);
  }

  return handleUnknown(args, () => showMainMenu(customer, sessionId));
}

async function handleAskName(args: DispatchArgs): Promise<void> {
  const { text, customer, sessionId } = args;
  const name = text.trim();

  if (name.length < 2 || name.length > 120) {
    await replyToCustomer(customer, 'Adınızı ve soyadınızı yazar mısınız?');
    return;
  }

  await prisma.customer.update({ where: { id: customer.id }, data: { name } });
  customer.name = name;

  await replyToCustomer(customer, `Teşekkürler ${name}! 🙂`);
  return askBarber({ ...args, sessionId });
}

async function askBarber(args: DispatchArgs): Promise<void> {
  const { shop, customer, sessionId, context } = args;

  const barbers = await prisma.barber.findMany({
    where: { shopId: shop.id, isActive: true },
    orderBy: { name: 'asc' },
  });

  if (barbers.length === 0) {
    await replyToCustomer(customer, 'Şu anda randevu alınamıyor. Lütfen daha sonra deneyin.');
    await setSession(sessionId, CHAT_STATE.IDLE, {});
    return;
  }

  // Tek berber varsa sormaya gerek yok
  if (barbers.length === 1) {
    const only = barbers[0]!;
    return askDate({
      ...args,
      context: { ...context, barberId: only.id, barberName: only.name },
    });
  }

  await replyToCustomer(customer, 'Hangi ustamızla randevu almak istersiniz?', {
    buttons: barbers.slice(0, 3).map((b) => ({
      id: `${PREFIX.BARBER}${b.id}`,
      title: b.name,
    })),
  });

  await setSession(sessionId, CHAT_STATE.SELECT_BARBER, context);
}

async function handleSelectBarber(args: DispatchArgs): Promise<void> {
  const { text, shop, context } = args;

  let barberId: string | null = null;

  if (text.startsWith(PREFIX.BARBER)) {
    barberId = text.slice(PREFIX.BARBER.length);
  } else {
    // Metin yazdıysa isimle eşleştirmeyi dene
    const barbers = await prisma.barber.findMany({
      where: { shopId: shop.id, isActive: true },
    });
    const normalized = normalizeTurkish(text);
    const match = barbers.find((b) => normalizeTurkish(b.name).includes(normalized));
    barberId = match?.id ?? null;
  }

  if (!barberId) return handleUnknown(args, () => askBarber(args));

  const barber = await prisma.barber.findFirst({
    where: { id: barberId, shopId: shop.id, isActive: true },
  });
  if (!barber) return handleUnknown(args, () => askBarber(args));

  return askDate({
    ...args,
    context: { ...context, barberId: barber.id, barberName: barber.name },
  });
}

function localDateString(offsetDays: number, timezone: string): string {
  const now = new Date();
  const parts = getZonedParts(now, timezone);
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
}

async function askDate(args: DispatchArgs): Promise<void> {
  const { customer, sessionId, context } = args;

  await replyToCustomer(customer, '📅 Hangi gün için randevu almak istersiniz?', {
    buttons: [
      { id: ACTION.DATE_TODAY, title: 'Bugün' },
      { id: ACTION.DATE_TOMORROW, title: 'Yarın' },
      { id: ACTION.DATE_OTHER, title: 'Başka gün' },
    ],
  });

  // Tarih burada saklanmıyor; "Bugün"/"Yarın" butonları tıklandığı ANDA
  // yeniden hesaplanıyor. Müşteri menüyü akşam açıp gece yarısından sonra
  // yanıtlarsa "bugün" doğru güne düşsün.
  await setSession(sessionId, CHAT_STATE.SELECT_DATE, { ...context, date: undefined, timeOffset: 0 });
}

async function handleSelectDate(args: DispatchArgs): Promise<void> {
  const { text, shop, customer, sessionId, context } = args;

  let date: string | null = null;

  if (text === ACTION.DATE_TODAY) date = localDateString(0, shop.timezone);
  else if (text === ACTION.DATE_TOMORROW) date = localDateString(1, shop.timezone);
  else if (text === ACTION.DATE_OTHER) {
    await replyToCustomer(
      customer,
      'Hangi tarihe randevu istersiniz? Lütfen GG/AA biçiminde yazın.\nÖrnek: 25/08',
    );
    await setSession(sessionId, CHAT_STATE.ASK_CUSTOM_DATE, context);
    return;
  } else {
    date = parseUserDate(text, shop.timezone);
  }

  if (!date) return handleUnknown(args, () => askDate(args));

  return askTime({ ...args, context: { ...context, date, timeOffset: 0 } });
}

async function handleCustomDate(args: DispatchArgs): Promise<void> {
  const { text, shop, context } = args;

  const date = parseUserDate(text, shop.timezone);
  if (!date) {
    await replyToCustomer(
      args.customer,
      'Tarihi anlayamadım 😅 Lütfen GG/AA biçiminde yazın. Örnek: 25/08',
    );
    return;
  }

  return askTime({ ...args, context: { ...context, date, timeOffset: 0 } });
}

/** "25/08", "25.08", "25 08" gibi girdileri yerel tarihe çevirir. */
function parseUserDate(input: string, timezone: string): string | null {
  const match = /^(\d{1,2})[./\s-](\d{1,2})(?:[./\s-](\d{2,4}))?$/.exec(input.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const nowParts = getZonedParts(new Date(), timezone);
  let year = match[3] ? Number(match[3]) : nowParts.year;
  if (year < 100) year += 2000;

  // Yıl verilmediyse ve tarih geçmişte kalıyorsa gelecek yıl kastedilmiştir
  if (!match[3]) {
    const candidate = Date.UTC(year, month - 1, day);
    const today = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
    if (candidate < today) year += 1;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Saat seçimi.
 *
 * Hizmet henüz seçilmediği için süre olarak ilk aktif hizmetin süresi
 * kullanılıyor. Tüm hizmetler aynı süreye sahip olduğu sürece bu doğru;
 * süreler farklılaşırsa akış "önce hizmet, sonra saat" olarak değişmeli.
 */
async function askTime(args: DispatchArgs): Promise<void> {
  const { shop, customer, sessionId, context } = args;

  if (!context.barberId || !context.date) return askBarber(args);

  const service = await prisma.service.findFirst({
    where: { shopId: shop.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (!service) {
    await replyToCustomer(customer, 'Şu anda hizmet tanımlı değil. Lütfen bizi arayın.');
    return;
  }

  const slots = await getAvailableSlots(shop.id, context.barberId, service.id, context.date);

  if (slots.length === 0) {
    // Kapalı gün mü, yoksa gün dolu mu? todo.md iki ayrı mesaj istiyor —
    // aynı jenerik "saat kalmadı" ikisini de gizler, müşteri kapalı bir güne
    // ısrar edip edemeyeceğini anlayamaz.
    const { year, month, day } = parseDateString(context.date);
    const dayOfWeek = getZonedParts(
      new Date(Date.UTC(year, month - 1, day, 12)),
      shop.timezone,
    ).dayOfWeek;
    const workingHours = await prisma.workingHours.findUnique({
      where: { barberId_dayOfWeek: { barberId: context.barberId, dayOfWeek } },
    });
    const isClosedDay = !workingHours || !workingHours.isWorking;

    await replyToCustomer(
      customer,
      isClosedDay
        ? `Seçtiğiniz tarihte kapalıyız 😔\nBaşka bir gün deneyelim mi?`
        : `${formatDateTr(context.date, shop.timezone)} günü için uygun saat kalmamış 😔\nBaşka bir gün deneyelim mi?`,
      {
        buttons: [
          { id: ACTION.DATE_TODAY, title: 'Bugün' },
          { id: ACTION.DATE_TOMORROW, title: 'Yarın' },
          { id: ACTION.DATE_OTHER, title: 'Başka gün' },
        ],
      },
    );
    await setSession(sessionId, CHAT_STATE.SELECT_DATE, { ...context, date: undefined });
    return;
  }

  const offset = context.timeOffset ?? 0;
  const page = slots.slice(offset, offset + SLOTS_PER_PAGE);
  const hasMore = slots.length > offset + SLOTS_PER_PAGE;

  const rows: ListRow[] = page.map((s) => ({
    id: `${PREFIX.SLOT}${s.startsAt.toISOString()}`,
    title: s.label,
  }));

  if (hasMore) {
    rows.push({ id: ACTION.MORE_TIMES, title: 'Diğer saatler →' });
  }

  await replyToCustomer(
    customer,
    `🕘 ${context.barberName} — ${formatDateTr(context.date, shop.timezone)}\nUygun saatler:`,
    { list: { buttonLabel: 'Saat seç', rows } },
  );

  await setSession(sessionId, CHAT_STATE.SELECT_TIME, context);
}

async function handleSelectTime(args: DispatchArgs): Promise<void> {
  const { text, context } = args;

  if (text === ACTION.MORE_TIMES) {
    return askTime({
      ...args,
      context: { ...context, timeOffset: (context.timeOffset ?? 0) + SLOTS_PER_PAGE },
    });
  }

  let startsAt: string | null = null;

  if (text.startsWith(PREFIX.SLOT)) {
    startsAt = text.slice(PREFIX.SLOT.length);
  } else {
    // "14:15" gibi yazdıysa eşleştir
    const normalized = text.trim().replace('.', ':');
    if (/^\d{1,2}:\d{2}$/.test(normalized) && context.barberId && context.date) {
      const service = await prisma.service.findFirst({
        where: { shopId: args.shop.id, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      if (service) {
        const slots = await getAvailableSlots(
          args.shop.id,
          context.barberId,
          service.id,
          context.date,
        );
        const padded = normalized.padStart(5, '0');
        startsAt = slots.find((s) => s.label === padded)?.startsAt.toISOString() ?? null;
      }
    }
  }

  if (!startsAt) return handleUnknown(args, () => askTime(args));

  const timeLabel = formatLocalTime(new Date(startsAt), args.shop.timezone);
  return askService({ ...args, context: { ...context, startsAt, timeLabel } });
}

async function askService(args: DispatchArgs): Promise<void> {
  const { shop, customer, sessionId, context } = args;

  const services = await prisma.service.findMany({
    where: { shopId: shop.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (services.length === 0) {
    await replyToCustomer(customer, 'Şu anda hizmet tanımlı değil. Lütfen bizi arayın.');
    return;
  }

  await replyToCustomer(customer, '✂️ Ne yaptırmak istersiniz?', {
    list: {
      buttonLabel: 'Hizmet seç',
      rows: services.map((s) => ({ id: `${PREFIX.SERVICE}${s.id}`, title: s.name })),
    },
  });

  await setSession(sessionId, CHAT_STATE.SELECT_SERVICE, context);
}

async function handleSelectService(args: DispatchArgs): Promise<void> {
  const { text, shop, context } = args;

  let serviceId: string | null = null;

  if (text.startsWith(PREFIX.SERVICE)) {
    serviceId = text.slice(PREFIX.SERVICE.length);
  } else {
    const services = await prisma.service.findMany({
      where: { shopId: shop.id, isActive: true },
    });
    const normalized = normalizeTurkish(text);
    serviceId = services.find((s) => normalizeTurkish(s.name) === normalized)?.id ?? null;
  }

  if (!serviceId) return handleUnknown(args, () => askService(args));

  const service = await prisma.service.findFirst({
    where: { id: serviceId, shopId: shop.id, isActive: true },
  });
  if (!service) return handleUnknown(args, () => askService(args));

  return showConfirmation({
    ...args,
    context: { ...context, serviceId: service.id, serviceName: service.name },
  });
}

/**
 * Özet ekranını gösterir VE randevuyu `pending_confirm` olarak DB'de rezerve
 * eder — todo.md'nin "5 dakika içinde onaylanmazsa randevu oluşturulmadı"
 * akışı ancak böyle gerçek olabilir. Rezervasyon burada yapılmazsa (eskiden
 * olduğu gibi yalnızca "Onayla"ya basılınca oluşturulursa) 5 dakikalık
 * `confirmDeadline`'ın koruyacağı hiçbir kayıt yoktur; `expirePendingAppointments`
 * cron'u (jobs/cleanup.ts) zaten süresi geçmiş pending_confirm kayıtlarını
 * otomatik iptal ediyor — eksik olan tek şey bu kaydın hiç açılmamasıydı.
 */
async function showConfirmation(args: DispatchArgs): Promise<void> {
  const { shop, customer, sessionId, context } = args;

  if (!context.date || !context.startsAt || !context.barberId || !context.serviceId || !customer.name) {
    return showMainMenu(customer, sessionId);
  }

  // ── Aynı güne birden fazla randevu engeli ────────────
  const existing = await prisma.appointment.findFirst({
    where: {
      customerId: customer.id,
      status: { in: [APPOINTMENT_STATUS.PENDING_CONFIRM, APPOINTMENT_STATUS.CONFIRMED] },
      startsAt: {
        gte: new Date(new Date(context.startsAt).setUTCHours(0, 0, 0, 0)),
        lt: new Date(new Date(context.startsAt).setUTCHours(23, 59, 59, 999)),
      },
    },
  });

  if (existing) {
    await replyToCustomer(
      customer,
      'Bu güne zaten bir randevunuz var 🙂 Aynı güne ikinci randevu alınamıyor.',
      { buttons: mainMenuButtons() },
    );
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
    return;
  }

  let appointmentId: string;
  try {
    const appointment = await createAppointment({
      shopId: shop.id,
      barberId: context.barberId,
      serviceId: context.serviceId,
      startsAt: new Date(context.startsAt),
      customerName: customer.name,
      customerPhone: customer.phone ?? undefined,
      source: 'whatsapp',
      status: APPOINTMENT_STATUS.PENDING_CONFIRM,
    });
    appointmentId = appointment.id;
  } catch (error) {
    if (error instanceof SlotTakenError || error instanceof ConflictError) {
      // Slot gerçekten dolu (çakışma kısıtı ya da ön kontrol) — beklenen bir
      // durum, kullanıcıya güncel saatler yeniden sunuluyor.
      logger.info({ err: error }, 'Chatbot rezervasyonu slot doluluğuna takıldı');
      await replyToCustomer(customer, 'Bu saat az önce doldu 😔 Başka bir saat seçelim mi?');
      return askTime({ ...args, context: { ...context, timeOffset: 0 } });
    }

    // Beklenmeyen bir hata (ör. berber/hizmet o an devre dışı bırakılmış,
    // veritabanı sorunu). "Saat doldu" demek yanıltıcı olur — gerçek sorunu
    // gizler. Hatayı gerçek bir hata olarak logla, müşteriye genel mesaj ver.
    logger.error({ err: error }, 'Chatbot randevu rezervasyonu beklenmeyen hatayla başarısız oldu');
    await replyToCustomer(
      customer,
      'Üzgünüz, şu anda randevunuzu oluşturamadık 😔 Lütfen birazdan tekrar deneyin ya da bizi arayın.' +
        (shop.contactPhone ? `\n📞 ${shop.contactPhone}` : ''),
      { buttons: mainMenuButtons() },
    );
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
    return;
  }

  await replyToCustomer(
    customer,
    '📋 *Randevu Özeti*\n\n' +
      `👤 ${context.barberName}\n` +
      `📅 ${formatDateTr(context.date, shop.timezone)}\n` +
      `🕘 ${context.timeLabel}\n` +
      `✂️ ${context.serviceName}\n\n` +
      `_${shop.confirmTimeoutMin} dakika içinde onaylamazsanız bu saat serbest kalır._`,
    {
      buttons: [
        { id: ACTION.CONFIRM_YES, title: '✅ Onayla' },
        { id: ACTION.CONFIRM_NO, title: '❌ Vazgeç' },
      ],
    },
  );

  await setSession(sessionId, CHAT_STATE.CONFIRM, { ...context, pendingAppointmentId: appointmentId });
}

async function handleConfirm(args: DispatchArgs): Promise<void> {
  const { text, shop, customer, sessionId, context } = args;
  const normalized = normalizeTurkish(text);

  const confirmed =
    text === ACTION.CONFIRM_YES || normalized === 'onayla' || normalized === 'evet';
  const declined =
    text === ACTION.CONFIRM_NO || normalized === 'vazgeç' || normalized === 'vazgec';

  if (!context.pendingAppointmentId) {
    // Oturum başka bir yoldan (ör. süresi dolup sıfırlanmış) buraya düşmüş —
    // rezerve edilmiş bir randevu yok, baştan başlanmalı.
    return showMainMenu(customer, sessionId);
  }

  if (declined) {
    await cancelAppointment(
      customer.shopId,
      context.pendingAppointmentId,
      'customer',
      'Müşteri onaylamadı (Vazgeç)',
    ).catch((error: unknown) => {
      // Zaten süresi dolup cron tarafından iptal edilmiş olabilir — sorun değil.
      logger.debug({ err: error }, 'Vazgeçilen pending randevu iptal edilirken hata (muhtemelen zaten iptal)');
    });

    await replyToCustomer(customer, 'Randevu oluşturulmadı. Başka bir konuda yardımcı olabilir miyiz?', {
      buttons: mainMenuButtons(),
    });
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
    return;
  }

  if (!confirmed) return handleUnknown(args, () => showConfirmation(args));

  try {
    const appointment = await confirmPendingAppointment(shop.id, context.pendingAppointmentId);

    await replyToCustomer(
      customer,
      '✅ *Randevunuz oluşturuldu!*\n\n' +
        `${formatDateTr(context.date!, shop.timezone)} saat ${context.timeLabel}'te ` +
        `${context.barberName} sizi bekliyor 💈\n\n` +
        '_Randevudan 1 gün ve 1 saat önce hatırlatma göndereceğiz._',
    );

    logger.info({ appointmentId: appointment.id }, 'Chatbot üzerinden randevu onaylandı');
    // IDLE değil MAIN_MENU: WhatsApp'ta önceki mesajların butonları hâlâ
    // tıklanabilir durumda. IDLE'da kalırsak müşteri "Randevularım" butonuna
    // bastığında bot butonu işlemek yerine menüyü baştan gösterir.
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
  } catch (error) {
    // confirmPendingAppointment yalnızca NOT_PENDING (ConflictError) fırlatır:
    // 5 dakikalık süre dolup expirePendingAppointments cron'u kaydı zaten
    // iptal etmiş demektir — Onayla'ya basmak artık işe yaramaz.
    logger.info({ err: error }, 'Onaylanmak istenen randevunun süresi dolmuş');
    await replyToCustomer(
      customer,
      '⏰ Onay süresi doldu, bu saat serbest kaldı. Yeniden randevu almak ister misiniz?',
      { buttons: mainMenuButtons() },
    );
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
  }
}

// ─────────────────────────────────────────────────────────
// Randevularım / iptal
// ─────────────────────────────────────────────────────────

async function loadActiveAppointments(customerId: string) {
  return prisma.appointment.findMany({
    where: {
      customerId,
      status: { in: [APPOINTMENT_STATUS.PENDING_CONFIRM, APPOINTMENT_STATUS.CONFIRMED] },
      startsAt: { gte: new Date() },
    },
    include: { barber: true, service: true },
    orderBy: { startsAt: 'asc' },
    take: 10,
  });
}

async function showMyAppointments(args: DispatchArgs): Promise<void> {
  const { shop, customer, sessionId } = args;

  const appointments = await loadActiveAppointments(customer.id);

  if (appointments.length === 0) {
    await replyToCustomer(customer, 'Aktif randevunuz bulunmuyor.', {
      buttons: mainMenuButtons(),
    });
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
    return;
  }

  const lines = appointments.map((a) => {
    const parts = getZonedParts(a.startsAt, shop.timezone);
    const date = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    return `✅ ${formatDateTr(date, shop.timezone)} — ${formatLocalTime(a.startsAt, shop.timezone)}\n   ${a.service.name} · ${a.barber.name}`;
  });

  await replyToCustomer(customer, `📅 *Aktif randevularınız*\n\n${lines.join('\n\n')}`, {
    buttons: mainMenuButtons(),
  });

  await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
}

async function startCancelFlow(args: DispatchArgs): Promise<void> {
  const { shop, customer, sessionId } = args;

  const appointments = await loadActiveAppointments(customer.id);

  if (appointments.length === 0) {
    await replyToCustomer(customer, 'İptal edilecek aktif randevunuz bulunmuyor.', {
      buttons: mainMenuButtons(),
    });
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
    return;
  }

  const rows: ListRow[] = appointments.map((a) => {
    const parts = getZonedParts(a.startsAt, shop.timezone);
    const date = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    return {
      id: `${PREFIX.APPOINTMENT}${a.id}`,
      title: `${formatLocalTime(a.startsAt, shop.timezone)} — ${a.service.name}`,
      description: `${formatDateTr(date, shop.timezone)} · ${a.barber.name}`,
    };
  });

  await replyToCustomer(customer, 'Hangi randevuyu iptal etmek istersiniz?', {
    list: { buttonLabel: 'Randevu seç', rows },
  });

  await setSession(sessionId, CHAT_STATE.SELECT_CANCEL_TARGET, {});
}

async function handleSelectCancelTarget(args: DispatchArgs): Promise<void> {
  const { text, shop, customer, sessionId } = args;

  if (!text.startsWith(PREFIX.APPOINTMENT)) {
    return handleUnknown(args, () => startCancelFlow(args));
  }

  const appointmentId = text.slice(PREFIX.APPOINTMENT.length);

  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, customerId: customer.id },
    include: { barber: true, service: true },
  });

  if (!appointment) return handleUnknown(args, () => startCancelFlow(args));

  // ── İptal kesim saati ────────────────────────────────
  // Kural (kaç dakika kala iptal edilemez) tek yerde: services/appointments.ts.
  // Burada elle tekrarlanmıyor — biri değişip diğeri unutulursa iki ayrı
  // yerde tutarsız bir kesim saati ortaya çıkardı.
  try {
    await assertCustomerCanCancel(shop.id, appointmentId);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;

    await replyToCustomer(
      customer,
      `Randevunuza ${shop.cancelCutoffMin} dakikadan az kaldığı için buradan iptal edemiyorum 😔\n` +
        'Lütfen bizi arayın' +
        (shop.contactPhone ? `: ${shop.contactPhone}` : '.'),
      { buttons: mainMenuButtons() },
    );
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
    return;
  }

  const parts = getZonedParts(appointment.startsAt, shop.timezone);
  const date = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

  await replyToCustomer(
    customer,
    `❗ ${formatDateTr(date, shop.timezone)} saat ${formatLocalTime(appointment.startsAt, shop.timezone)} ` +
      'randevunuzu iptal etmek istediğinizden emin misiniz?',
    {
      buttons: [
        { id: ACTION.CONFIRM_YES, title: 'Evet, iptal et' },
        { id: ACTION.CONFIRM_NO, title: 'Vazgeç' },
      ],
    },
  );

  await setSession(sessionId, CHAT_STATE.CONFIRM_CANCEL, { cancelTargetId: appointmentId });
}

async function handleConfirmCancel(args: DispatchArgs): Promise<void> {
  const { text, shop, customer, sessionId, context } = args;
  const normalized = normalizeTurkish(text);

  const confirmed = text === ACTION.CONFIRM_YES || normalized === 'evet';
  const declined = text === ACTION.CONFIRM_NO || normalized === 'vazgeç' || normalized === 'hayır';

  if (declined) {
    await replyToCustomer(customer, 'Randevunuz duruyor 🙂', { buttons: mainMenuButtons() });
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
    return;
  }

  if (!confirmed || !context.cancelTargetId) {
    return handleUnknown(args, () => startCancelFlow(args));
  }

  await cancelAppointment(shop.id, context.cancelTargetId, 'customer', 'Müşteri iptali');

  await replyToCustomer(customer, '✅ Randevunuz iptal edildi. Görüşmek üzere! 👋', {
    buttons: mainMenuButtons(),
  });

  await setSession(sessionId, CHAT_STATE.MAIN_MENU, {});
}

// ─────────────────────────────────────────────────────────
// Anlaşılmayan mesaj
// ─────────────────────────────────────────────────────────

/**
 * Anlaşılmayan mesajda sayacı artırır; üst üste 3 olursa müşteriyi insana
 * yönlendirir. Bu olmadan yanlış anlaşılan müşteri botla sonsuz döngüye girer.
 */
async function handleUnknown(args: DispatchArgs, retry: () => Promise<void>): Promise<void> {
  const { customer, sessionId, invalidInputCount, shop } = args;
  const newCount = invalidInputCount + 1;

  if (newCount >= MAX_INVALID_INPUTS) {
    await replyToCustomer(
      customer,
      'Sizi anlayamadım 😅 Ustayı doğrudan arayabilirsiniz' +
        (shop.contactPhone ? `:\n📞 ${shop.contactPhone}` : '.'),
      { buttons: mainMenuButtons() },
    );
    // Sayaç sıfırlanıyor ki müşteri baştan deneyebilsin
    await setSession(sessionId, CHAT_STATE.MAIN_MENU, {}, 0);
    return;
  }

  await replyToCustomer(
    customer,
    'Bunu anlayamadım 😅 Lütfen aşağıdaki seçeneklerden birini kullanın.',
  );

  await retry();

  // ⚠️ Sayaç retry'DAN SONRA yazılıyor. retry() adımı yeniden kurarken
  // setSession çağırıyor ve sayacı varsayılan 0'a çekiyor; önce yazsaydık
  // sayaç hiç artmaz, "3 hatada insana yönlendir" koruması hiç devreye girmezdi.
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { invalidInputCount: newCount },
  });
}
