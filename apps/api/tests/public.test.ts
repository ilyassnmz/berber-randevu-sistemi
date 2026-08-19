import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';
import { zonedTimeToUtc } from '../src/lib/time.js';
import { FakeWhatsAppClient, setWhatsAppClient } from '../src/services/whatsapp/client.js';

/**
 * Herkese açık randevu uçları — entegrasyon testleri.
 *
 * Bu uçlar internetteki HERKESE açık (giriş yok), bu yüzden testler iki ayrı
 * soruyu ayrı ayrı kovalıyor:
 *
 *   1. Doğru çalışıyor mu? (randevu oluşuyor, iptal ediliyor, slot boşalıyor)
 *   2. Fazlasını yapmıyor mu? (başka müşterinin verisi sızmıyor, kurallar
 *      atlanamıyor, tahmin edilemeyen anahtar olmadan randevuya erişilemiyor)
 */

const app = createApp();
const BASE = '/api/v1/public';
const TZ = 'Europe/Istanbul';

const fake = new FakeWhatsAppClient();

let fx: TestFixture;

/**
 * ⚠️ Slot ızgarası 09:00'dan başlayıp 45'er dakika ilerliyor (09:00, 09:45,
 * 10:30 ...). Izgara dışı bir saat TARİHTEN BAĞIMSIZ olarak reddedilir; testi
 * onunla yazmak "kural çalıştı" yanılsaması üretir.
 */
const SLOT_TIME = '09:00';
const SECOND_SLOT_TIME = '09:45';

/** Sınırın içinde (7 günden yakın). */
const nearDate = localDatePlusDays(3);
/** Sınırın dışında — müşteri buraya randevu alamamalı. */
const farDate = localDatePlusDays(20);

function localDatePlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function bookingBody(overrides: Record<string, unknown> = {}) {
  return {
    barberId: fx.adminId,
    serviceId: fx.serviceId,
    startsAt: zonedTimeToUtc(nearDate, SLOT_TIME, TZ).toISOString(),
    customerName: 'Siteden Gelen Müşteri',
    customerPhone: '+905321112233',
    ...overrides,
  };
}

beforeAll(async () => {
  setWhatsAppClient(fake);
  fx = await createFixture();

  /**
   * Sitenin hangi dükkana ait olduğunu sabitliyoruz.
   *
   * Zorunlu: geliştirme ve üretim şu an AYNI veritabanını paylaşıyor, yani
   * test sırasında gerçek dükkan da aktif durumda. Bu değişken olmadan
   * `getPublicShop()` iki aktif dükkan görüp bilerek hata fırlatır.
   */
  process.env.PUBLIC_SHOP_ID = fx.shopId;

  for (const barberId of [fx.adminId, fx.staffId]) {
    await testPrisma.workingHours.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        shopId: fx.shopId,
        barberId,
        dayOfWeek,
        startTime: '09:00',
        endTime: '20:15',
        isWorking: true,
      })),
      skipDuplicates: true,
    });
  }
});

afterAll(async () => {
  delete process.env.PUBLIC_SHOP_ID;
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
  setWhatsAppClient(null);
});

beforeEach(async () => {
  await testPrisma.appointment.deleteMany({ where: { shopId: fx.shopId } });
  // Kara liste testi müşteriyi işaretliyor; diğer testlere sızmasın.
  await testPrisma.customer.updateMany({
    where: { shopId: fx.shopId },
    data: { isBlacklisted: false },
  });
});

describe('GET /shop — giriş gerektirmez', () => {
  it('dükkan, hizmet ve berber bilgisini jetonsuz döner', async () => {
    const res = await request(app).get(`${BASE}/shop`);

    expect(res.status).toBe(200);
    expect(res.body.shop.name).toBeTruthy();
    expect(res.body.shop.maxAdvanceDays).toBe(7);
    expect(res.body.services.length).toBeGreaterThan(0);
    expect(res.body.barbers.length).toBeGreaterThan(0);
  });

  it('berberlerin e-posta ve şifre bilgisini SIZDIRMAZ', async () => {
    const res = await request(app).get(`${BASE}/shop`);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('@');
    expect(body.toLowerCase()).not.toContain('password');
    expect(body.toLowerCase()).not.toContain('hash');
  });
});

describe('GET /slots', () => {
  it('sınırın içindeki gün için saatleri döner', async () => {
    const res = await request(app).get(`${BASE}/slots`).query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: nearDate,
    });

    expect(res.status).toBe(200);
    expect(res.body.slots.length).toBeGreaterThan(0);
    expect(res.body.slots[0].label).toBe('09:00');
  });

  it('7 günden ileri bir gün için HİÇ saat döndürmez', async () => {
    const res = await request(app).get(`${BASE}/slots`).query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: farDate,
    });

    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(0);
  });

  it('dolu saat listeden düşer', async () => {
    await request(app).post(`${BASE}/appointments`).send(bookingBody());

    const res = await request(app).get(`${BASE}/slots`).query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: nearDate,
    });

    const labels = res.body.slots.map((s: { label: string }) => s.label);
    expect(labels).not.toContain(SLOT_TIME);
  });

  it('eksik parametreyi doğrulama hatasıyla reddeder', async () => {
    const res = await request(app).get(`${BASE}/slots`).query({ barberId: fx.adminId });
    expect(res.status).toBe(400);
  });
});

describe('POST /appointments — siteden randevu', () => {
  it('randevu oluşturur, kaynağını web olarak işaretler ve anahtar döner', async () => {
    const res = await request(app).post(`${BASE}/appointments`).send(bookingBody());

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(res.body.appointment.status).toBe('confirmed');

    const stored = await testPrisma.appointment.findFirst({
      where: { shopId: fx.shopId },
    });
    expect(stored?.source).toBe('web');
    expect(stored?.publicToken).toBe(res.body.token);
  });

  it('her randevuya FARKLI bir anahtar üretir', async () => {
    const first = await request(app).post(`${BASE}/appointments`).send(bookingBody());

    const second = await request(app)
      .post(`${BASE}/appointments`)
      .send(
        bookingBody({
          startsAt: zonedTimeToUtc(localDatePlusDays(4), SLOT_TIME, TZ).toISOString(),
          customerPhone: '+905321119999',
        }),
      );

    expect(second.status).toBe(201);
    expect(second.body.token).not.toBe(first.body.token);
  });

  it('geçersiz telefon numarasını reddeder', async () => {
    const res = await request(app)
      .post(`${BASE}/appointments`)
      .send(bookingBody({ customerPhone: '12345' }));

    expect(res.status).toBe(400);
  });

  it('telefon numarası olmadan randevu almaya izin vermez', async () => {
    const body = bookingBody();
    delete (body as Record<string, unknown>).customerPhone;

    const res = await request(app).post(`${BASE}/appointments`).send(body);
    expect(res.status).toBe(400);
  });

  it('7 günden ileriye randevu ALAMAZ', async () => {
    const res = await request(app)
      .post(`${BASE}/appointments`)
      .send({
        ...bookingBody(),
        startsAt: zonedTimeToUtc(farDate, SLOT_TIME, TZ).toISOString(),
      });

    expect(res.status).toBe(409);
  });

  it('aynı güne ikinci randevuyu reddeder', async () => {
    await request(app).post(`${BASE}/appointments`).send(bookingBody());

    // Aynı telefon, aynı gün, BAŞKA saat — saat boş olmasına rağmen reddedilmeli
    const res = await request(app)
      .post(`${BASE}/appointments`)
      .send(bookingBody({ startsAt: zonedTimeToUtc(nearDate, SECOND_SLOT_TIME, TZ).toISOString() }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_SAME_DAY');
  });

  it('aynı telefon FARKLI güne randevu alabilir', async () => {
    // Kontrol grubu: yukarıdaki reddin "aynı gün" kuralından geldiğini,
    // numaranın topyekûn engellenmediğini kanıtlıyor.
    await request(app).post(`${BASE}/appointments`).send(bookingBody());

    const res = await request(app)
      .post(`${BASE}/appointments`)
      .send(
        bookingBody({
          startsAt: zonedTimeToUtc(localDatePlusDays(4), SLOT_TIME, TZ).toISOString(),
        }),
      );

    expect(res.status).toBe(201);
  });

  it('dolu saate ikinci randevuyu reddeder', async () => {
    await request(app).post(`${BASE}/appointments`).send(bookingBody());

    const res = await request(app)
      .post(`${BASE}/appointments`)
      .send(bookingBody({ customerPhone: '+905327778899' }));

    expect(res.status).toBe(409);
  });

  it('kara listedeki müşteriye randevu vermez', async () => {
    await request(app).post(`${BASE}/appointments`).send(bookingBody());

    await testPrisma.customer.updateMany({
      where: { shopId: fx.shopId, phone: '+905321112233' },
      data: { isBlacklisted: true },
    });
    await testPrisma.appointment.deleteMany({ where: { shopId: fx.shopId } });

    const res = await request(app).post(`${BASE}/appointments`).send(bookingBody());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOMER_BLACKLISTED');
  });
});

describe('Anahtarla randevu görüntüleme ve iptal', () => {
  async function book(): Promise<string> {
    const res = await request(app).post(`${BASE}/appointments`).send(bookingBody());
    return res.body.token as string;
  }

  it('anahtarla randevu detayını döner', async () => {
    const token = await book();

    const res = await request(app).get(`${BASE}/appointments/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.appointment.serviceName).toBeTruthy();
    expect(res.body.appointment.barberName).toBeTruthy();
    expect(res.body.appointment.status).toBe('confirmed');
  });

  it('randevu detayında müşterinin TELEFONU dönmez', async () => {
    // Bağlantı paylaşılabilir/loglanabilir bir şey; içinden telefon numarası
    // okunabilmemeli.
    const token = await book();

    const res = await request(app).get(`${BASE}/appointments/${token}`);

    expect(JSON.stringify(res.body)).not.toContain('905321112233');
  });

  it('bilinmeyen anahtarı 404 ile reddeder', async () => {
    const res = await request(app).get(`${BASE}/appointments/${'a'.repeat(32)}`);
    expect(res.status).toBe(404);
  });

  it('biçimsiz anahtarı doğrulama hatasıyla reddeder', async () => {
    const res = await request(app).get(`${BASE}/appointments/kisa`);
    expect(res.status).toBe(400);
  });

  it('anahtarla randevuyu iptal eder ve saati serbest bırakır', async () => {
    const token = await book();

    const cancelled = await request(app).post(`${BASE}/appointments/${token}/cancel`).send({});
    expect(cancelled.status).toBe(200);

    const stored = await testPrisma.appointment.findFirst({ where: { publicToken: token } });
    expect(stored?.status).toBe('cancelled');

    // Saat gerçekten boşaldı mı?
    const slots = await request(app).get(`${BASE}/slots`).query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: nearDate,
    });
    const labels = slots.body.slots.map((s: { label: string }) => s.label);
    expect(labels).toContain(SLOT_TIME);
  });

  it('aynı randevuyu ikinci kez iptal etmeyi reddeder', async () => {
    const token = await book();

    await request(app).post(`${BASE}/appointments/${token}/cancel`).send({});
    const second = await request(app).post(`${BASE}/appointments/${token}/cancel`).send({});

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_CANCELLED');
  });

  it('bilinmeyen anahtarla iptal denemesini 404 ile reddeder', async () => {
    const res = await request(app)
      .post(`${BASE}/appointments/${'b'.repeat(32)}/cancel`)
      .send({});

    expect(res.status).toBe(404);
  });
});

/**
 * Müşteri adının güncellenmesi.
 *
 * Gerçek bir şikâyetten doğdu: "randevu oluşturduğumda müşteri adı yanlış
 * görünüyor". Sebebi, aynı telefon numarası kayıtlıysa randevuda yazılan
 * ismin sessizce yok sayılmasıydı — panelde hep ilk kaydedilen isim
 * görünüyordu.
 *
 * Sessiz veri kaybı olduğu için özellikle sinsiydi: hata mesajı yok,
 * randevu başarıyla oluşuyor, sadece isim yanlış.
 */
describe('Müşteri adı — en son verilen isim geçerlidir', () => {
  it('aynı numarayla alınan ikinci randevuda YENİ isim görünür', async () => {
    const ilk = await request(app)
      .post(`${BASE}/appointments`)
      .send(bookingBody({ customerName: 'Ali Önceki' }));
    expect(ilk.status).toBe(201);
    expect(ilk.body.appointment.customerName).toBe('Ali Önceki');

    // Aynı telefon, BAŞKA gün (aynı güne ikinci randevu zaten yasak)
    const ikinci = await request(app)
      .post(`${BASE}/appointments`)
      .send(
        bookingBody({
          customerName: 'Veli Sonraki',
          startsAt: zonedTimeToUtc(localDatePlusDays(4), SLOT_TIME, TZ).toISOString(),
        }),
      );

    expect(ikinci.status).toBe(201);
    expect(ikinci.body.appointment.customerName).toBe('Veli Sonraki');
  });

  it('müşteri kaydındaki isim de gerçekten güncellenir', async () => {
    await request(app).post(`${BASE}/appointments`).send(bookingBody({ customerName: 'Eski İsim' }));

    await request(app)
      .post(`${BASE}/appointments`)
      .send(
        bookingBody({
          customerName: 'Yeni İsim',
          startsAt: zonedTimeToUtc(localDatePlusDays(4), SLOT_TIME, TZ).toISOString(),
        }),
      );

    const musteri = await testPrisma.customer.findFirst({
      where: { shopId: fx.shopId, phone: '+905321112233' },
    });
    expect(musteri?.name).toBe('Yeni İsim');
  });

  it('aynı isimle tekrar randevu alınca gereksiz güncelleme yapmaz', async () => {
    // Davranışın kararlı olduğunu gösteriyor: isim değişmediyse kayıt aynı kalır.
    const ilk = await request(app)
      .post(`${BASE}/appointments`)
      .send(bookingBody({ customerName: 'Sabit İsim' }));

    const musteriOnce = await testPrisma.customer.findFirst({
      where: { shopId: fx.shopId, phone: '+905321112233' },
    });

    await request(app)
      .post(`${BASE}/appointments`)
      .send(
        bookingBody({
          customerName: 'Sabit İsim',
          startsAt: zonedTimeToUtc(localDatePlusDays(4), SLOT_TIME, TZ).toISOString(),
        }),
      );

    const musteriSonra = await testPrisma.customer.findFirst({
      where: { shopId: fx.shopId, phone: '+905321112233' },
    });

    expect(ilk.status).toBe(201);
    expect(musteriSonra?.id).toBe(musteriOnce?.id);
    expect(musteriSonra?.name).toBe('Sabit İsim');
  });
});

/**
 * Kapalı günler.
 *
 * Site, tarih şeridinde kapalı günleri soluk gösterip tıklanamaz yapıyor.
 * Bunu yapabilmesi için berberin çalıştığı günleri /shop yanıtından
 * öğrenmesi gerekiyor.
 *
 * Bilgi olmadan müşteri kapalı bir güne tıklayıp "uygun saat kalmamış"
 * mesajı alıyordu — o mesaj "doldu" demektir ve kapalı gün için yanıltıcıdır.
 */
describe('Berberin çalışma günleri', () => {
  it('/shop her berber için çalışılan günleri döner', async () => {
    const res = await request(app).get(`${BASE}/shop`);

    expect(res.status).toBe(200);
    for (const b of res.body.barbers) {
      expect(Array.isArray(b.workingDays)).toBe(true);
      // Fixture tüm günleri çalışır yapıyor
      expect(b.workingDays).toHaveLength(7);
    }
  });

  it('kapalı gün workingDays listesinde YER ALMAZ', async () => {
    // Pazar'ı (0) kapat
    await testPrisma.workingHours.updateMany({
      where: { barberId: fx.adminId, dayOfWeek: 0 },
      data: { isWorking: false },
    });

    const res = await request(app).get(`${BASE}/shop`);
    const admin = res.body.barbers.find((b: { id: string }) => b.id === fx.adminId);

    expect(admin.workingDays).not.toContain(0);
    expect(admin.workingDays).toHaveLength(6);

    // Diğer berber etkilenmemeli
    const staff = res.body.barbers.find((b: { id: string }) => b.id === fx.staffId);
    expect(staff.workingDays).toHaveLength(7);

    await testPrisma.workingHours.updateMany({
      where: { barberId: fx.adminId, dayOfWeek: 0 },
      data: { isWorking: true },
    });
  });
});

/**
 * Cihaz başına günlük FARKLI numara sınırı.
 *
 * Tehdit: telefon numarası doğrulanmıyor. Bir kişi her seferinde rastgele
 * bir numara yazarak "bir numara güne tek randevu" kuralını tamamen
 * atlayabilir — her numara sistem için yeni bir müşteri olduğu için kara
 * liste de işe yaramaz.
 *
 * Bu kural saldırıyı kaynağında kesiyor: numara değişse de cihaz aynı.
 */
describe('Aynı cihazdan günlük farklı numara sınırı', () => {
  /** Farklı günlere randevu alır; "aynı güne ikinci randevu" kuralına takılmasın. */
  async function alRandevu(gunOfset: number, telefon: string) {
    const tarih = localDatePlusDays(gunOfset);
    const slots = await request(app).get(`${BASE}/slots`).query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: tarih,
    });

    return request(app)
      .post(`${BASE}/appointments`)
      .send({
        barberId: fx.adminId,
        serviceId: fx.serviceId,
        startsAt: slots.body.slots[0].startsAt,
        customerName: 'Cihaz Testi',
        customerPhone: telefon,
      });
  }

  it('üç farklı numaraya izin verir, DÖRDÜNCÜyü reddeder', async () => {
    // Aynı test istemcisi = aynı IP = aynı cihaz özeti
    expect((await alRandevu(1, '+905990000001')).status).toBe(201);
    expect((await alRandevu(2, '+905990000002')).status).toBe(201);
    expect((await alRandevu(3, '+905990000003')).status).toBe(201);

    const dorduncu = await alRandevu(4, '+905990000004');
    expect(dorduncu.status).toBe(409);
    expect(dorduncu.body.error.code).toBe('DEVICE_PHONE_LIMIT');
  });

  it('sınıra ulaşılsa bile AYNI numara randevu almaya devam edebilir', async () => {
    // Kontrol grubu: sınır "farklı numara" sayısına bakıyor, kişinin kendi
    // randevu sayısına değil. Bir aile üyesi engellenmemeli.
    await alRandevu(1, '+905990000001');
    await alRandevu(2, '+905990000002');
    await alRandevu(3, '+905990000003');

    const ayniNumaraTekrar = await alRandevu(4, '+905990000001');
    expect(ayniNumaraTekrar.status).toBe(201);
  });

  it('randevuya cihaz özeti yazılır (ham IP değil)', async () => {
    const res = await alRandevu(1, '+905990000009');
    expect(res.status).toBe(201);

    const kayit = await testPrisma.appointment.findFirst({
      where: { shopId: fx.shopId },
      orderBy: { createdAt: 'desc' },
    });

    expect(kayit?.clientHash).toBeTruthy();
    // Özet olmalı: IP'ye benzememeli, sabit uzunlukta hex olmalı
    expect(kayit?.clientHash).toMatch(/^[a-f0-9]{32}$/);
    expect(kayit?.clientHash).not.toContain('.');
    expect(kayit?.clientHash).not.toContain(':');
  });
});

/**
 * Boş saat listesinin SEBEBİ.
 *
 * Berber izinliyken müşteriye "uygun saat kalmamış" deniyordu; bu "doldu"
 * anlamına gelir ve müşteriyi erken davranmaya iter. Oysa izinli günde ne
 * kadar erken bakarsa baksın yer açılmaz.
 */
describe('Boş saat listesinin sebebi', () => {
  it('kapalı günde reason=closed döner', async () => {
    await testPrisma.workingHours.updateMany({
      where: { barberId: fx.adminId },
      data: { isWorking: false },
    });

    const res = await request(app).get(`${BASE}/slots`).query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: nearDate,
    });

    expect(res.body.slots).toHaveLength(0);
    expect(res.body.reason).toBe('closed');

    await testPrisma.workingHours.updateMany({
      where: { barberId: fx.adminId },
      data: { isWorking: true },
    });
  });

  it('izin günü reason=timeoff döner (dolu DEĞİL)', async () => {
    // Günün tamamını kapatan izin
    await testPrisma.timeOff.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        startsAt: zonedTimeToUtc(nearDate, '00:00', TZ),
        endsAt: zonedTimeToUtc(nearDate, '23:59', TZ),
        reason: 'Yıllık izin',
      },
    });

    const res = await request(app).get(`${BASE}/slots`).query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: nearDate,
    });

    expect(res.body.slots).toHaveLength(0);
    expect(res.body.reason).toBe('timeoff');

    await testPrisma.timeOff.deleteMany({ where: { shopId: fx.shopId } });
  });

  it('saat varken reason null döner', async () => {
    const res = await request(app).get(`${BASE}/slots`).query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: nearDate,
    });

    expect(res.body.slots.length).toBeGreaterThan(0);
    expect(res.body.reason).toBeNull();
  });
});
