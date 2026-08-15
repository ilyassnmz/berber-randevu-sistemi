import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';
import { zonedTimeToUtc } from '../src/lib/time.js';
import { FakeWhatsAppClient, setWhatsAppClient } from '../src/services/whatsapp/client.js';
import {
  cancelAppointment,
  createAppointment,
  getAvailableSlots,
} from '../src/services/appointments.js';
import { BARBER_ROLE } from '@berber/shared';

/**
 * Randevu API'si — entegrasyon testleri.
 *
 * Özellikle iki şeyi kanıtlıyor:
 *   1. Yetki sınırları gerçekten uygulanıyor (Fırat, Müslüm'ün verisine erişemiyor)
 *   2. Çakışma HTTP katmanına kadar doğru şekilde yansıyor (409 SLOT_TAKEN)
 */

const app = createApp();
const BASE = '/api/v1/appointments';
const TZ = 'Europe/Istanbul';

const fake = new FakeWhatsAppClient();

let fx: TestFixture;
let adminToken: string;
let staffToken: string;

/** Testler için sabit bir gelecek tarih — geçmiş saat elemesine takılmasın. */
const TEST_DATE = futureWednesday();

function futureWednesday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function loginToken(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: fx.password });
  return res.body.accessToken as string;
}

beforeAll(async () => {
  setWhatsAppClient(fake);
  fx = await createFixture();

  // Her iki berbere de tam haftalık çalışma düzeni ver
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

  adminToken = await loginToken(fx.adminEmail);
  staffToken = await loginToken(fx.staffEmail);
});

afterAll(async () => {
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
  setWhatsAppClient(null);
});

beforeEach(async () => {
  await testPrisma.appointment.deleteMany({ where: { shopId: fx.shopId } });
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function slotAt(time: string): string {
  return zonedTimeToUtc(TEST_DATE, time, TZ).toISOString();
}

async function createWalkIn(token: string, barberId: string, time: string, name = 'Ahmet Yılmaz') {
  return request(app)
    .post(BASE)
    .set(auth(token))
    .send({
      barberId,
      serviceId: fx.serviceId,
      startsAt: slotAt(time),
      customerName: name,
    });
}

describe('Yetkilendirme', () => {
  it('jetonsuz erişimi reddeder', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it('staff, başka berberin boş saatlerini sorgulayamaz', async () => {
    // todo.md → "Fırat, Müslüm'ün randevularını API'den çekemiyor mu?"
    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(staffToken))
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: TEST_DATE });

    expect(res.status).toBe(403);
  });

  it('staff kendi boş saatlerini sorgulayabilir', async () => {
    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(staffToken))
      .query({ barberId: fx.staffId, serviceId: fx.serviceId, date: TEST_DATE });

    expect(res.status).toBe(200);
  });

  it('admin herkesin boş saatlerini sorgulayabilir', async () => {
    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.staffId, serviceId: fx.serviceId, date: TEST_DATE });

    expect(res.status).toBe(200);
  });

  it('staff listede kendi kimliğine sabitlenir', async () => {
    await createWalkIn(adminToken, fx.adminId, '09:00', 'Müslümün Müşterisi');
    await createWalkIn(staffToken, fx.staffId, '09:00', 'Fıratın Müşterisi');

    // Fırat, Müslüm'ün randevularını istese bile kendi listesini alır
    const res = await request(app)
      .get(BASE)
      .set(auth(staffToken))
      .query({ barberId: fx.adminId, date: TEST_DATE });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].barberId).toBe(fx.staffId);
  });

  it('staff, başka berberin randevusunu iptal edemez', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '10:30');

    const res = await request(app)
      .post(`${BASE}/${created.body.appointment.id}/cancel`)
      .set(auth(staffToken))
      .send({});

    expect(res.status).toBe(403);
  });
});

describe('GET /slots', () => {
  it('boş gün için tüm saatleri döner', async () => {
    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: TEST_DATE });

    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(15);
    expect(res.body.slots[0].label).toBe('09:00');
    expect(res.body.slots.at(-1).label).toBe('19:30');
  });

  it('dolu saat listeden düşer', async () => {
    await createWalkIn(adminToken, fx.adminId, '09:00');

    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: TEST_DATE });

    const labels = res.body.slots.map((s: { label: string }) => s.label);
    expect(labels).not.toContain('09:00');
    expect(labels).toHaveLength(14);
  });

  it('izinli aralık listeden düşer', async () => {
    await testPrisma.timeOff.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        startsAt: zonedTimeToUtc(TEST_DATE, '12:00', TZ),
        endsAt: zonedTimeToUtc(TEST_DATE, '13:30', TZ),
        reason: 'Öğle arası',
      },
    });

    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: TEST_DATE });

    const labels = res.body.slots.map((s: { label: string }) => s.label);
    expect(labels).not.toContain('12:00');
    expect(labels).not.toContain('12:45');
    expect(labels).toContain('13:30');

    await testPrisma.timeOff.deleteMany({ where: { shopId: fx.shopId } });
  });

  it('eksik parametreyi doğrulama hatasıyla reddeder', async () => {
    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId });

    expect(res.status).toBe(400);
  });
});

describe('POST / — walk-in randevu', () => {
  it('telefonsuz walk-in müşteri oluşturur', async () => {
    // Kapıdan gelen müşteri numarasını vermek zorunda değil
    const res = await createWalkIn(adminToken, fx.adminId, '09:00', 'İsimsiz Müşteri');

    expect(res.status).toBe(201);
    expect(res.body.appointment.source).toBe('panel');
    expect(res.body.appointment.status).toBe('confirmed');
    expect(res.body.appointment.customer.name).toBe('İsimsiz Müşteri');
    expect(res.body.appointment.customer.phone).toBeNull();
  });

  it('telefonlu müşteriyi mevcut kayda bağlar', async () => {
    const phone = '0532 111 22 33';

    const first = await request(app).post(BASE).set(auth(adminToken)).send({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt('09:00'),
      customerName: 'Mehmet Demir',
      customerPhone: phone,
    });

    // Aynı numara, farklı yazım biçimi
    const second = await request(app).post(BASE).set(auth(adminToken)).send({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt('10:30'),
      customerName: 'Mehmet Demir',
      customerPhone: '+905321112233',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // İki randevu AYNI müşteriye bağlanmalı
    expect(second.body.appointment.customerId).toBe(first.body.appointment.customerId);
  });

  it('bitiş saatini hizmet süresinden hesaplar', async () => {
    const res = await createWalkIn(adminToken, fx.adminId, '09:00');

    const startsAt = new Date(res.body.appointment.startsAt);
    const endsAt = new Date(res.body.appointment.endsAt);
    expect((endsAt.getTime() - startsAt.getTime()) / 60_000).toBe(45);
  });

  it('ızgaraya oturmayan saati reddeder', async () => {
    const res = await createWalkIn(adminToken, fx.adminId, '09:20');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('Idempotency-Key ile tekrar gönderilen istek ikinci bir randevu oluşturmaz', async () => {
    const key = `test-key-${Date.now()}`;
    const body = {
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt('19:30'),
      customerName: 'Tekrar Denemesi',
    };

    const first = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .set('Idempotency-Key', key)
      .send(body);
    const second = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.appointment.id).toBe(first.body.appointment.id);

    const count = await testPrisma.appointment.count({
      where: { shopId: fx.shopId, customer: { name: 'Tekrar Denemesi' } },
    });
    expect(count).toBe(1);
  });

  it('Idempotency-Key farklıysa ayrı randevu oluşturur', async () => {
    const bodyFor = (time: string) => ({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt(time),
      customerName: 'Farklı Anahtar',
    });

    const first = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .set('Idempotency-Key', `key-a-${Date.now()}`)
      .send(bodyFor('17:15'));
    const second = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .set('Idempotency-Key', `key-b-${Date.now()}`)
      .send(bodyFor('18:00'));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.appointment.id).not.toBe(first.body.appointment.id);
  });

  it('dolu saate ikinci randevuyu reddeder', async () => {
    await createWalkIn(adminToken, fx.adminId, '09:00');
    const second = await createWalkIn(adminToken, fx.adminId, '09:00');

    expect(second.status).toBe(409);
  });

  it('eşzamanlı iki istekten tam olarak biri başarılı olur', async () => {
    // Uygulama seviyesindeki müsaitlik kontrolü ikisini de geçirebilir;
    // veritabanı kısıtı ikincisini durdurur ve 409 SLOT_TAKEN döner.
    const [a, b] = await Promise.all([
      createWalkIn(adminToken, fx.adminId, '14:15', 'Müşteri A'),
      createWalkIn(adminToken, fx.adminId, '14:15', 'Müşteri B'),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('kara listedeki müşteriye randevu vermez', async () => {
    const phone = '+905329998877';
    await testPrisma.customer.create({
      data: {
        shopId: fx.shopId,
        name: 'Kara Liste',
        phone,
        isBlacklisted: true,
        blacklistNote: 'Test',
      },
    });

    const res = await request(app).post(BASE).set(auth(adminToken)).send({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt('09:00'),
      customerName: 'Kara Liste',
      customerPhone: phone,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOMER_BLACKLISTED');
  });

  it('geçersiz telefon numarasını reddeder', async () => {
    const res = await request(app).post(BASE).set(auth(adminToken)).send({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt('09:00'),
      customerName: 'Test',
      customerPhone: '02121234567', // sabit hat
    });

    expect(res.status).toBe(400);
  });
});

describe('Durum değişiklikleri', () => {
  it('tamamlandı olarak işaretler', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '09:00');

    const res = await request(app)
      .post(`${BASE}/${created.body.appointment.id}/complete`)
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('completed');
  });

  it('gelmedi işaretler ve müşteri sayacını artırır', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '09:00');
    const customerId = created.body.appointment.customerId;

    const before = await testPrisma.customer.findUnique({ where: { id: customerId } });

    const res = await request(app)
      .post(`${BASE}/${created.body.appointment.id}/no-show`)
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('no_show');

    const after = await testPrisma.customer.findUnique({ where: { id: customerId } });
    expect(after!.noShowCount).toBe(before!.noShowCount + 1);
  });

  it('iptal eder ve sebebi kaydeder', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '09:00');

    const res = await request(app)
      .post(`${BASE}/${created.body.appointment.id}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'Berber hastalandı' });

    expect(res.status).toBe(200);
    expect(res.body.appointment.status).toBe('cancelled');
    expect(res.body.appointment.cancelledBy).toBe('barber');
    expect(res.body.appointment.cancelReason).toBe('Berber hastalandı');
  });

  it('iptal edilen randevu saatini serbest bırakır', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '09:00');
    await request(app)
      .post(`${BASE}/${created.body.appointment.id}/cancel`)
      .set(auth(adminToken))
      .send({});

    // Aynı saat yeniden alınabilmeli
    const rebooked = await createWalkIn(adminToken, fx.adminId, '09:00', 'Yeni Müşteri');
    expect(rebooked.status).toBe(201);
  });

  it('sonuçlanmış randevu tekrar sonuçlandırılamaz', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '09:00');
    const id = created.body.appointment.id;

    await request(app).post(`${BASE}/${id}/complete`).set(auth(adminToken));
    const second = await request(app).post(`${BASE}/${id}/cancel`).set(auth(adminToken)).send({});

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_FINALISED');
  });

  it('olmayan randevu için 404 döner', async () => {
    const res = await request(app)
      .post(`${BASE}/${crypto.randomUUID()}/complete`)
      .set(auth(adminToken));

    expect(res.status).toBe(404);
  });
});

describe('Erteleme', () => {
  it('randevuyu başka saate taşır', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '09:00');

    const res = await request(app)
      .post(`${BASE}/${created.body.appointment.id}/reschedule`)
      .set(auth(adminToken))
      .send({ startsAt: slotAt('15:00') });

    expect(res.status).toBe(200);
    expect(new Date(res.body.appointment.startsAt).toISOString()).toBe(slotAt('15:00'));

    // Eski saat serbest kalmalı
    const slots = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: TEST_DATE });

    const labels = slots.body.slots.map((s: { label: string }) => s.label);
    expect(labels).toContain('09:00');
    expect(labels).not.toContain('15:00');
  });

  it('dolu saate ertelemeyi reddeder', async () => {
    const first = await createWalkIn(adminToken, fx.adminId, '09:00', 'İlk');
    await createWalkIn(adminToken, fx.adminId, '10:30', 'İkinci');

    const res = await request(app)
      .post(`${BASE}/${first.body.appointment.id}/reschedule`)
      .set(auth(adminToken))
      .send({ startsAt: slotAt('10:30') });

    expect(res.status).toBe(409);
  });
});

describe('GET / — listeleme', () => {
  it('tarihe göre filtreler', async () => {
    await createWalkIn(adminToken, fx.adminId, '09:00');
    await createWalkIn(adminToken, fx.adminId, '10:30');

    const res = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ date: TEST_DATE });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    // Saate göre sıralı
    expect(res.body.items[0].localStartTime).toBe('09:00');
    expect(res.body.items[1].localStartTime).toBe('10:30');
  });

  it('yerel saat gösterimini ekler', async () => {
    await createWalkIn(adminToken, fx.adminId, '09:00');

    const res = await request(app).get(BASE).set(auth(adminToken)).query({ date: TEST_DATE });

    expect(res.body.items[0].localStartTime).toBe('09:00');
    expect(res.body.items[0].localEndTime).toBe('09:45');
  });

  it('duruma göre filtreler', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '09:00');
    await createWalkIn(adminToken, fx.adminId, '10:30');

    await request(app)
      .post(`${BASE}/${created.body.appointment.id}/cancel`)
      .set(auth(adminToken))
      .send({});

    const res = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ date: TEST_DATE, status: 'cancelled' });

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(created.body.appointment.id);
  });

  it('sayfalama yapar', async () => {
    await createWalkIn(adminToken, fx.adminId, '09:00');
    await createWalkIn(adminToken, fx.adminId, '10:30');
    await createWalkIn(adminToken, fx.adminId, '12:00');

    const page1 = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ date: TEST_DATE, limit: 2 });

    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ date: TEST_DATE, limit: 2, cursor: page1.body.nextCursor });

    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
  });
});

describe('Müşteri bildirimleri (notifyCustomer)', () => {
  async function createWithPhone(time: string, phone: string) {
    return request(app).post(BASE).set(auth(adminToken)).send({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt(time),
      customerName: 'Bildirim Testi',
      customerPhone: phone,
    });
  }

  it('iptalde varsayılan olarak (notifyCustomer belirtilmeden) müşteriye WhatsApp gider', async () => {
    const created = await createWithPhone('09:00', '+905551110001');
    fake.clear();

    const res = await request(app)
      .post(`${BASE}/${created.body.appointment.id}/cancel`)
      .set(auth(adminToken))
      .send({});

    expect(res.status).toBe(200);
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0]!.to).toBe('+905551110001');
  });

  it('notifyCustomer: false ile iptalde mesaj gitmez', async () => {
    const created = await createWithPhone('10:30', '+905551110002');
    fake.clear();

    const res = await request(app)
      .post(`${BASE}/${created.body.appointment.id}/cancel`)
      .set(auth(adminToken))
      .send({ notifyCustomer: false });

    expect(res.status).toBe(200);
    expect(fake.messages).toHaveLength(0);
  });

  it('walk-in oluştururken notifyCustomer: true ile onay mesajı gider', async () => {
    fake.clear();

    const res = await request(app).post(BASE).set(auth(adminToken)).send({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt('12:00'),
      customerName: 'Bildirim Testi 2',
      customerPhone: '+905551110003',
      notifyCustomer: true,
    });

    expect(res.status).toBe(201);
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0]!.to).toBe('+905551110003');
  });

  it('walk-in oluştururken notifyCustomer belirtilmezse (varsayılan false) mesaj gitmez', async () => {
    fake.clear();
    const res = await createWithPhone('13:30', '+905551110004');
    expect(res.status).toBe(201);
    expect(fake.messages).toHaveLength(0);
  });
});

describe('Gelmedi (no-show) uyarısı', () => {
  async function createWalkInWithPhone(time: string, phone: string) {
    return request(app).post(BASE).set(auth(adminToken)).send({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: slotAt(time),
      customerName: 'No-show Testi',
      customerPhone: phone,
    });
  }

  it('3. gelmedi de tam eşikte bir kez uyarı mesajı gönderir, 4.\'te tekrar göndermez', async () => {
    const phone = '+905551110005';

    const first = await createWalkInWithPhone('09:00', phone);
    const second = await createWalkInWithPhone('10:30', phone);
    const third = await createWalkInWithPhone('12:00', phone);
    const fourth = await createWalkInWithPhone('13:30', phone);

    await request(app).post(`${BASE}/${first.body.appointment.id}/no-show`).set(auth(adminToken));
    await request(app).post(`${BASE}/${second.body.appointment.id}/no-show`).set(auth(adminToken));

    fake.clear();
    const thirdRes = await request(app)
      .post(`${BASE}/${third.body.appointment.id}/no-show`)
      .set(auth(adminToken));
    expect(thirdRes.status).toBe(200);
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0]!.to).toBe(phone);

    fake.clear();
    const fourthRes = await request(app)
      .post(`${BASE}/${fourth.body.appointment.id}/no-show`)
      .set(auth(adminToken));
    expect(fourthRes.status).toBe(200);
    expect(fake.messages).toHaveLength(0);
  });
});

describe('Servis katmanında yetki kontrolü (route\'tan bağımsız)', () => {
  it('cancelAppointment servis fonksiyonu, auth context uyuşmazsa route çağrılmadan da reddeder', async () => {
    const created = await createWalkIn(adminToken, fx.adminId, '15:00');

    // staff (Fırat), admin'in (Müslüm) randevusunu servis fonksiyonunu
    // DOĞRUDAN çağırarak (route/middleware'i tamamen atlayarak) iptal etmeye
    // çalışıyor. Route katmanı burada devrede değil — bu, savunmanın
    // gerçekten servis katmanında da var olduğunun kanıtı.
    await expect(
      cancelAppointment(
        fx.shopId,
        created.body.appointment.id,
        'barber',
        undefined,
        fx.staffId,
        false,
        { barberId: fx.staffId, shopId: fx.shopId, role: BARBER_ROLE.STAFF },
      ),
    ).rejects.toThrow('Yalnızca kendi randevularınıza erişebilirsiniz');

    const stillActive = await testPrisma.appointment.findUnique({
      where: { id: created.body.appointment.id },
    });
    expect(stillActive?.status).toBe('confirmed');
  });
});

/**
 * İleri tarih sınırı (shops.maxAdvanceDays = 7).
 *
 * Kural TEK bir sayı olarak dükkan ayarında duruyor ama HERKESE aynı
 * uygulanmıyor: müşteri en fazla 1 hafta sonrasına randevu alabilir, berber
 * ise istediği tarihe girebilir (düğün gibi ileri tarihli talepleri telefonla
 * alıp elle işleyebilsin diye).
 *
 * Bu ayrım sessizce bozulmaya çok müsait — sınır paylaşılan slot motorunda
 * yaşıyor ve oraya yeni bir çağıran eklendiğinde varsayılan davranış devreye
 * giriyor. Aşağıdaki testler ayrımın iki yönünü de kilitliyor.
 */
describe('İleri tarih sınırı yalnızca müşteri tarafına uygulanır', () => {
  /**
   * 20 gün sonrası. Bilerek TEST_DATE'in (bugün+7 ile bugün+13 arası bir
   * çarşamba) erişemeyeceği kadar uzak seçildi — iki tarih çakışırsa testler
   * birbirinin randevusuna takılırdı.
   */
  const farDate = localDatePlusDays(20);

  /** Sınırın İÇİNDE bir gün — kontrol grubu (aşağıdaki gerekçeye bakın). */
  const nearDate = localDatePlusDays(3);

  /**
   * ⚠️ Izgara üstünde bir saat olmalı.
   *
   * Slot ızgarası 09:00'dan başlayıp 45'er dakika ilerliyor (09:00, 09:45,
   * 10:30 ...). "10:00" gibi ızgara dışı bir saat TARİHTEN BAĞIMSIZ olarak
   * reddedilir; onunla yazılan bir test "ileri tarih reddedildi" sanıp yanlış
   * sebeple geçer.
   */
  const SLOT_TIME = '09:00';

  function localDatePlusDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  it('müşteri 7 günden ileriye randevu ALAMAZ', async () => {
    await expect(
      createAppointment({
        shopId: fx.shopId,
        barberId: fx.adminId,
        serviceId: fx.serviceId,
        startsAt: zonedTimeToUtc(farDate, SLOT_TIME, TZ),
        customerName: 'Uzak Tarih Müşterisi',
        customerPhone: '+905559998877',
        source: 'web',
      }),
    ).rejects.toThrow(/müsait değil/i);
  });

  it('aynı müşteri sınırın içindeki bir güne AYNI saatte randevu alabilir', async () => {
    // Kontrol grubu: yukarıdaki reddin gerçekten TARİH yüzünden olduğunu
    // kanıtlıyor. Bu test olmadan, saatin ızgara dışı olması gibi bambaşka
    // bir sebeple gelen bir ret de testi "geçirir" ve sınır aslında hiç
    // sınanmamış olur.
    const appointment = await createAppointment({
      shopId: fx.shopId,
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: zonedTimeToUtc(nearDate, SLOT_TIME, TZ),
      customerName: 'Yakın Tarih Müşterisi',
      customerPhone: '+905559998877',
      source: 'web',
    });

    expect(appointment.id).toBeTruthy();
    expect(appointment.source).toBe('web');
  });

  it('müşteriye 7 gün ötesi için hiç saat gösterilmez', async () => {
    // auth verilmiyor → çağıran müşteri tarafı (site/chatbot)
    const slots = await getAvailableSlots(fx.shopId, fx.adminId, fx.serviceId, farDate);
    expect(slots).toHaveLength(0);
  });

  it('berber panelden 7 günden ileriye randevu girebilir', async () => {
    const appointment = await createAppointment({
      shopId: fx.shopId,
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      startsAt: zonedTimeToUtc(farDate, SLOT_TIME, TZ),
      customerName: 'Düğün Müşterisi',
      customerPhone: '+905557776655',
      source: 'panel',
    });

    expect(appointment.id).toBeTruthy();
    expect(appointment.source).toBe('panel');
  });

  it('berbere panelde 7 gün ötesi için saatler gösterilir', async () => {
    const res = await request(app)
      .get(`${BASE}/slots`)
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: farDate })
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.slots.length).toBeGreaterThan(0);
  });
});
