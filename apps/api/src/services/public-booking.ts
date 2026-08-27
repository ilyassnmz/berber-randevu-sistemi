import { randomBytes } from 'node:crypto';
import { APPOINTMENT_SOURCE, formatServiceNames } from '@berber/shared';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import { hashClientIp } from '../lib/client-hash.js';
import { yeniRandevuBildirimi } from './push.js';
import { localDayBounds, formatLocalDate, formatLocalTime, formatDateTr } from '../lib/time.js';
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


/**
 * Aynı cihazdan bir günde kaç FARKLI telefon numarasına randevu alınabilir.
 *
 * ── Neden bu kural var? ──────────────────────────────────────────
 *
 * Telefon numarası doğrulanmıyor. "Bir numara güne tek randevu" kuralı,
 * tek numarayla saldırıyı 7 randevuyla sınırlıyor — ama saldırgan her
 * seferinde RASTGELE bir numara yazarsa o kural hiç devreye girmiyor,
 * çünkü her numara sistem için yeni bir müşteri. Kara liste de işe
 * yaramıyor, aynı sebeple.
 *
 * Bu kural saldırıyı kaynağında kesiyor: numara değişse de cihaz aynı.
 *
 * ── Neden 3? ─────────────────────────────────────────────────────
 *
 * Gerçek kullanımda aynı bağlantıdan birden fazla numara olağan: baba,
 * eş, iki çocuk. 1 ya da 2 olsaydı bu aileleri engellerdi. 3, ailenin
 * rahatça geçtiği ama sahte numara üretmenin hemen duvara çarptığı yer.
 *
 * ⚠️ Kesin çözüm DEĞİL: cihazını mobil veriye alıp adresini değiştiren
 * biri aşabilir. Ama bu artık "sinirli müşteri" değil, uğraşmaya kararlı
 * biri demektir — ve o durumda berberin toplu iptal aracı devreye giriyor.
 */
const GUNLUK_FARKLI_NUMARA_SINIRI = 3;

/**
 * Aynı cihazdan bugün kaç farklı numaraya randevu alındığını kontrol eder.
 *
 * Aynı numara tekrar randevu alıyorsa sayılmaz — sınır FARKLI numara sayısı
 * üzerinden işliyor, kişinin kendi randevu sayısı üzerinden değil.
 */
async function assertCihazSinirinaTakilmadi(params: {
  shopId: string;
  timezone: string;
  clientHash: string | null;
  phone: string;
}): Promise<void> {
  const { shopId, timezone, clientHash, phone } = params;

  // IP çözülemediyse (beklenmez) kuralı uygulayamayız; randevuyu engellemek
  // yerine geçiriyoruz — diğer korumalar (gün başına tek randevu, hız sınırı,
  // 7 günlük pencere) hâlâ yerinde.
  if (!clientHash) return;

  const bugun = formatLocalDate(new Date(), timezone);
  const { start, end } = localDayBounds(bugun, timezone);

  const bugunkuRandevular = await prisma.appointment.findMany({
    where: { shopId, clientHash, createdAt: { gte: start, lt: end } },
    select: { customer: { select: { phone: true } } },
  });

  const farkliNumaralar = new Set(
    bugunkuRandevular.map((a) => a.customer.phone).filter((t): t is string => Boolean(t)),
  );

  // Zaten bu numaraya randevu alınmışsa yeni bir "farklı numara" değil.
  if (farkliNumaralar.has(phone)) return;

  if (farkliNumaralar.size >= GUNLUK_FARKLI_NUMARA_SINIRI) {
    logger.warn(
      { shopId, clientHash, farkliNumaraSayisi: farkliNumaralar.size },
      'Cihaz başına günlük farklı numara sınırına takılan randevu denemesi',
    );
    throw new ConflictError(
      'Bugün bu cihazdan çok sayıda farklı numaraya randevu alınmış. ' +
        'Yarın tekrar deneyebilir ya da bizi arayabilirsiniz.',
      'DEVICE_PHONE_LIMIT',
    );
  }
}

/** Sitenin açılışta ihtiyaç duyduğu her şey: dükkan, hizmetler, berberler. */
export async function getPublicShopInfo() {
  const shop = await getPublicShop();

  const [services, barbers] = await Promise.all([
    prisma.service.findMany({
      where: { shopId: shop.id, isActive: true },
      // `requiresOwnSlot`: site, seçim yapıldıkça toplam süreyi kendi
      // hesaplayıp gösterebilsin diye ("Saç + Lazer · 1 sa 30 dk").
      // Sunucu bu hesabı zaten yapıyor; buradaki kopya yalnızca müşteriye
      // anında geri bildirim vermek için ve aynı paylaşılan fonksiyonu
      // (@berber/shared → computeAppointmentDuration) kullanıyor.
      select: { id: true, name: true, durationMin: true, price: true, requiresOwnSlot: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.barber.findMany({
      where: { shopId: shop.id, isActive: true },
      select: {
        id: true,
        name: true,
        // Hangi günler çalışıyor? Site, kapalı günleri tarih şeridinde
        // baştan soluk gösterebilsin diye burada dönüyor.
        workingHours: { select: { dayOfWeek: true, isWorking: true } },
      },
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

    /**
     * ⚠️ `price` SAYIYA çevriliyor.
     *
     * Veritabanında Decimal duruyor ve JSON'a METİN olarak çıkıyor ("500").
     * Site, çoklu seçimde fiyatları TOPLUYOR; metin olarak geldiğinde
     * toplama sessizce birleştirmeye dönüşüyordu: Saç (500) + Lazer (2000)
     * ekranda "5.002.000 ₺" olarak göründü. Tek tek gösterimde fark
     * edilmiyordu, çünkü biçimlendirme metni de kabul ediyor.
     */
    services: services.map((s) => ({
      ...s,
      price: s.price === null ? null : Number(s.price),
    })),

    /**
     * `workingDays`: berberin çalıştığı gün numaraları (0 = Pazar).
     *
     * Site bunu tarih şeridinde kapalı günleri soluk göstermek için
     * kullanıyor. Olmadığında müşteri kapalı bir güne tıklayıp "uygun saat
     * kalmamış" mesajıyla karşılaşıyordu — bu mesaj "dolmuş" anlamına gelir
     * ve kapalı gün için YANILTICIdır.
     */
    barbers: barbers.map((b) => ({
      id: b.id,
      name: b.name,
      workingDays: b.workingHours.filter((w) => w.isWorking).map((w) => w.dayOfWeek),
    })),
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
  /** Müşterinin seçtiği hizmetlerin tamamı ("Saç + Ağda"). */
  serviceIds: readonly string[];
  startsAt: Date;
  customerName: string;
  customerPhone: string;
  /** Express'in çözdüğü istemci IP'si. Özetlenip saklanır, hamı asla.  */
  clientIp?: string | undefined;
}) {
  const shop = await getPublicShop();
  const publicToken = generatePublicToken();
  const clientHash = hashClientIp(input.clientIp);

  await assertCihazSinirinaTakilmadi({
    shopId: shop.id,
    timezone: shop.timezone,
    clientHash,
    phone: input.customerPhone,
  });

  const appointment = await createAppointment({
    shopId: shop.id,
    barberId: input.barberId,
    serviceIds: input.serviceIds,
    startsAt: input.startsAt,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    source: APPOINTMENT_SOURCE.WEB,
    publicToken,
    clientHash,
  });

  logger.info(
    { appointmentId: appointment.id, barberId: input.barberId },
    'İnternet sitesinden randevu oluşturuldu',
  );

  /**
   * Berbere bildirim.
   *
   * ⚠️ `await` VAR ama içeride her hata yutuluyor (bkz. services/push.ts).
   * Bilinçli: randevu zaten oluştu ve müşteriye "alındı" denecek; bildirim
   * gönderilememesi bunu geri alamaz. Gönderim beklenmesinin sebebi ise
   * arka planda kalan bir işin sunucu kapanırken kaybolmaması.
   */
  const yerelGun = formatLocalDate(appointment.startsAt, shop.timezone);
  await yeniRandevuBildirimi({
    shopId: shop.id,
    barberId: appointment.barberId,
    barberName: appointment.barber.name,
    customerName: appointment.customer.name,
    // Bildirimde hizmetlerin tamamı yazıyor: berber telefonuna düşen
    // bildirimden randevunun 45 mi 90 dakika mı olduğunu anlayabilmeli.
    serviceName: formatServiceNames(appointment.services),
    zaman: `${formatDateTr(yerelGun, shop.timezone)}, ${formatLocalTime(appointment.startsAt, shop.timezone)}`,
  });

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
    include: {
      barber: true,
      service: true,
      customer: true,
      services: { include: { service: true }, orderBy: { service: { sortOrder: 'asc' } } },
    },
  });

  if (!appointment) {
    throw new NotFoundError('Randevu bulunamadı');
  }

  const services = appointment.services.map((s) => s.service);

  return {
    id: appointment.id,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    cancelReason: appointment.cancelReason,
    barberName: appointment.barber.name,
    services: services.map((s) => ({
      name: s.name,
      price: s.price === null ? null : Number(s.price),
    })),
    // Eski (önbellekteki) site sürümü bu iki alanı okuyor — bkz. routes/public.ts.
    serviceName: formatServiceNames(services),
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
