import { randomBytes } from 'node:crypto';
import { APPOINTMENT_SOURCE } from '@berber/shared';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import {
  createAppointment,
  cancelAppointment,
  assertCustomerCanCancel,
} from './appointments.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  HERKESE AÇIK RANDEVU AKIŞI (internet sitesi)
 * ══════════════════════════════════════════════════════════════════
 *
 * Randevu alma WhatsApp chatbot'undan buraya taşındı; WhatsApp artık yalnızca
 * siteye yönlendirme yapıyor.
 *
 * ── Bu katman neden var? ──────────────────────────────────────────
 *
 * Bu uçları çağıran kişi kimliği doğrulanmamış bir ziyaretçi. Panel uçlarında
 * `req.auth` her şeyi sınırlıyor — hangi dükkan, hangi berber, hangi müşteri.
 * Burada öyle bir sınır YOK, dolayısıyla her sınır elle çizilmek zorunda:
 *
 *   * Dükkan istemciden GELMEZ, sunucuda çözülür (aşağıya bakın).
 *   * Yanıtlarda yalnızca herkese açık olması gereken alanlar döner —
 *     müşteri adı, telefonu, gelmedi sayacı gibi alanlar dışarı sızmamalı.
 *   * Randevuya erişim, tahmin edilemez bir anahtarla (publicToken) yapılır.
 */

/**
 * Randevu bağlantısındaki gizli anahtar.
 *
 * 24 bayt = 192 bit rastgelelik; kaba kuvvetle bulunması pratikte imkânsız.
 * base64url seçildi çünkü URL'de kodlanmadan, olduğu gibi taşınabiliyor.
 */
function generatePublicToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Sitenin ait olduğu dükkanı çözer.
 *
 * ⚠️ Dükkan kimliği BİLEREK istemciden alınmıyor. Alınsaydı, ziyaretçi başka
 * bir dükkanın kimliğini göndererek onun verisini okuyabilir ve ona randevu
 * yazabilirdi. Bugün kurulum tek dükkanlı; birden fazla aktif dükkan çıkarsa
 * bu bir yapılandırma hatasıdır ve sessizce rastgele birine düşmek yerine
 * gürültülü şekilde patlaması doğrusu.
 */
export async function getPublicShop() {
  // ⚠️ Doğrulanmış `env` nesnesi yerine `process.env` — bilerek.
  //
  // `config/env.ts` ortam değişkenlerini MODÜL YÜKLENİRKEN bir kez okuyor.
  // Bu değer ise çalışma anında okunmak zorunda: entegrasyon testleri her
  // koşuda yeni bir test dükkanı oluşturuyor ve kimliğini ancak o an
  // bilebiliyor. Ayrıca geliştirme ve üretim şu an AYNI veritabanını
  // paylaştığı için, testler sırasında birden fazla aktif dükkan bulunuyor;
  // bu değişken olmadan aşağıdaki "tek dükkan" çözümü belirsizliğe düşerdi.
  const pinnedShopId = process.env.PUBLIC_SHOP_ID;

  if (pinnedShopId) {
    const shop = await prisma.shop.findFirst({ where: { id: pinnedShopId, isActive: true } });
    if (!shop) {
      logger.error({ pinnedShopId }, 'PUBLIC_SHOP_ID tanımlı ama böyle aktif bir dükkan yok');
      throw new NotFoundError('Dükkan bulunamadı');
    }
    return shop;
  }

  const shops = await prisma.shop.findMany({ where: { isActive: true }, take: 2 });

  if (shops.length === 0) {
    throw new NotFoundError('Dükkan bulunamadı');
  }

  if (shops.length > 1) {
    logger.error(
      { count: shops.length },
      'Birden fazla aktif dükkan var — herkese açık sitenin hangisine ait olduğu belirlenemiyor. PUBLIC_SHOP_ID tanımlayın.',
    );
    // Rastgele birine düşmek, sitenin sessizce YANLIŞ dükkanın randevularını
    // yönetmesi demek olurdu. Gürültülü şekilde başarısız olmak doğrusu.
    throw new Error('Dükkan yapılandırması belirsiz — PUBLIC_SHOP_ID tanımlanmalı');
  }

  return shops[0]!;
}

/** Sitenin açılışta ihtiyaç duyduğu her şey: dükkan, hizmetler, berberler. */
export async function getPublicShopInfo() {
  const shop = await getPublicShop();

  const [services, barbers] = await Promise.all([
    prisma.service.findMany({
      where: { shopId: shop.id, isActive: true },
      select: { id: true, name: true, durationMin: true, price: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.barber.findMany({
      where: { shopId: shop.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    shop: {
      name: shop.name,
      timezone: shop.timezone,
      contactPhone: shop.contactPhone,
      /** Site, tarih şeridini bu kadar günle sınırlar. */
      maxAdvanceDays: shop.maxAdvanceDays,
      cancelCutoffMin: shop.cancelCutoffMin,
    },
    services,
    barbers,
  };
}

/**
 * Siteden randevu oluşturur.
 *
 * Randevu doğrudan `confirmed` olarak açılıyor — chatbot'taki `pending_confirm`
 * ara adımının burada karşılığı yok. O adım, WhatsApp'ta müşteri akışı yarıda
 * bırakabildiği için vardı; sitede "Onayla" düğmesine basmak zaten onaydır.
 *
 * Slot müsaitliği, kara liste, aynı güne ikinci randevu ve 7 günlük ileri tarih
 * sınırı burada TEKRARLANMIYOR — hepsi `createAppointment` içinde, yani
 * randevu oluşturmanın tek ortak noktasında yaşıyor.
 */
export async function createPublicAppointment(input: {
  barberId: string;
  serviceId: string;
  startsAt: Date;
  customerName: string;
  customerPhone: string;
}) {
  const shop = await getPublicShop();
  const publicToken = generatePublicToken();

  const appointment = await createAppointment({
    shopId: shop.id,
    barberId: input.barberId,
    serviceId: input.serviceId,
    startsAt: input.startsAt,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    source: APPOINTMENT_SOURCE.WEB,
    publicToken,
  });

  logger.info(
    { appointmentId: appointment.id, barberId: input.barberId },
    'İnternet sitesinden randevu oluşturuldu',
  );

  return { appointment, publicToken };
}

/**
 * Randevuyu gizli anahtarıyla bulur.
 *
 * Döndürülen nesne bilerek dar tutuldu: müşterinin kendi adı dışında hiçbir
 * müşteri alanı (telefon, gelmedi sayacı, kara liste durumu) dışarı çıkmıyor.
 */
export async function getAppointmentByToken(token: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { publicToken: token },
    include: { barber: true, service: true, customer: true },
  });

  if (!appointment) {
    throw new NotFoundError('Randevu bulunamadı');
  }

  return {
    id: appointment.id,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    cancelReason: appointment.cancelReason,
    barberName: appointment.barber.name,
    serviceName: appointment.service.name,
    servicePrice: appointment.service.price,
    customerName: appointment.customer.name,
  };
}

/**
 * Randevuyu gizli anahtarıyla iptal eder.
 *
 * İptal kesim saati kuralı (`shops.cancelCutoffMin`) elle tekrarlanmıyor;
 * `assertCustomerCanCancel` tek doğruluk kaynağı. Chatbot da aynı fonksiyonu
 * kullanıyor, böylece iki kanal arasında kural ayrışması olamıyor.
 */
export async function cancelAppointmentByToken(token: string) {
  const existing = await prisma.appointment.findUnique({
    where: { publicToken: token },
    select: { id: true, shopId: true, status: true },
  });

  if (!existing) {
    throw new NotFoundError('Randevu bulunamadı');
  }

  if (existing.status === 'cancelled') {
    throw new ConflictError('Bu randevu zaten iptal edilmiş.', 'ALREADY_CANCELLED');
  }

  await assertCustomerCanCancel(existing.shopId, existing.id);

  return cancelAppointment(existing.shopId, existing.id, 'customer', 'Müşteri siteden iptal etti');
}
