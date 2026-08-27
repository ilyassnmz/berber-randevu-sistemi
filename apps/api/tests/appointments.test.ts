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
        serviceIds: [fx.serviceId],
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
      serviceIds: [fx.serviceId],
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
    const slots = await getAvailableSlots(fx.shopId, fx.adminId, [fx.serviceId], farDate);
    expect(slots).toHaveLength(0);
  });

  it('berber panelden 7 günden ileriye randevu girebilir', async () => {
    const appointment = await createAppointment({
      shopId: fx.shopId,
      barberId: fx.adminId,
      serviceIds: [fx.serviceId],
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

/**
 * Tarih ARALIĞI filtresi (from/to).
 *
 * Panelin "yaklaşan randevular" şeridi buna dayanıyor: takvim yalnızca
 * seçili günü gösterdiği için, başka günlerdeki randevular ancak bu
 * filtreyle yüzeye çıkıyor.
 *
 * Filtre kodda vardı ama HİÇ test edilmemişti — ve gerçek bir arıza tam
 * buradan çıktı: siteden yarına alınan randevular panelde görünmüyordu,
 * çünkü panel yalnızca bugünü sorguluyordu.
 */
describe('GET / — tarih aralığı (from/to) filtresi', () => {
  function gunEkle(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  const gunA = gunEkle(2);
  const gunB = gunEkle(4);
  const gunC = gunEkle(6);

  async function randevuAc(date: string, saat = '09:00') {
    // Kaynak 'panel': berber olarak oluşturuluyor, böylece müşteri
    // kısıtları (7 gün penceresi, aynı güne ikinci randevu) devreye girmiyor.
    return createAppointment({
      shopId: fx.shopId,
      barberId: fx.adminId,
      serviceIds: [fx.serviceId],
      startsAt: zonedTimeToUtc(date, saat, TZ),
      customerName: 'Aralık Testi',
      source: 'panel',
    });
  }

  it('aralıktaki tüm günlerin randevularını döner', async () => {
    await randevuAc(gunA);
    await randevuAc(gunB);
    await randevuAc(gunC);

    const res = await request(app)
      .get(BASE)
      .query({ barberId: fx.adminId, from: gunA, to: gunC })
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
  });

  it('aralık dışındaki günü DIŞARIDA bırakır', async () => {
    await randevuAc(gunA);
    await randevuAc(gunC);

    const res = await request(app)
      .get(BASE)
      .query({ barberId: fx.adminId, from: gunA, to: gunB })
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('bitiş günü aralığa DAHİL', async () => {
    // Sınır davranışı: "to" günü dışarıda kalsaydı, şerit haftanın son
    // gününü hiç göstermezdi.
    await randevuAc(gunB);

    const res = await request(app)
      .get(BASE)
      .query({ barberId: fx.adminId, from: gunA, to: gunB })
      .set(auth(adminToken));

    expect(res.body.items).toHaveLength(1);
  });
});

/**
 * Aynı cihazdan toplu iptal.
 *
 * Sahte numaralarla takvim doldurma girişiminde randevular farklı isimler,
 * farklı numaralar ve farklı günlerle dağılmış oluyor. Berberin elindeki tek
 * ortak nokta cihaz özeti; onsuz tek tek avlamak gerekiyor ve biri kaçıyor.
 */
describe('Aynı cihazdan toplu iptal', () => {
  const CIHAZ = 'a'.repeat(32);
  const BASKA_CIHAZ = 'b'.repeat(32);

  function ileriGun(n: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  async function sahteRandevu(gun: number, telefon: string, cihaz: string, barberId = fx.adminId) {
    return createAppointment({
      shopId: fx.shopId,
      barberId,
      serviceIds: [fx.serviceId],
      startsAt: zonedTimeToUtc(ileriGun(gun), '09:00', TZ),
      customerName: 'Sahte ' + telefon.slice(-4),
      customerPhone: telefon,
      source: 'web',
      clientHash: cihaz,
    });
  }

  it('aynı cihazdan gelen diğer randevuları listeler', async () => {
    const ilk = await sahteRandevu(1, '+905991110001', CIHAZ);
    await sahteRandevu(2, '+905991110002', CIHAZ);
    await sahteRandevu(3, '+905991110003', CIHAZ);
    // Başka cihazdan gelen bir randevu — listeye GİRMEMELİ
    await sahteRandevu(4, '+905991110004', BASKA_CIHAZ);

    const res = await request(app).get(`${BASE}/${ilk.id}/siblings`).set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
  });

  it('hepsini tek işlemle iptal eder, başka cihazınkine DOKUNMAZ', async () => {
    const ilk = await sahteRandevu(1, '+905991110001', CIHAZ);
    await sahteRandevu(2, '+905991110002', CIHAZ);
    const masum = await sahteRandevu(3, '+905991110009', BASKA_CIHAZ);

    const res = await request(app)
      .post(`${BASE}/${ilk.id}/cancel-siblings`)
      .set(auth(adminToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(2);

    const iptaller = await testPrisma.appointment.findMany({
      where: { shopId: fx.shopId, clientHash: CIHAZ },
    });
    expect(iptaller.every((a) => a.status === 'cancelled')).toBe(true);

    const dokunulmayan = await testPrisma.appointment.findUnique({ where: { id: masum.id } });
    expect(dokunulmayan?.status).toBe('confirmed');
  });

  it('iptal edilen saatler tekrar müsait olur', async () => {
    const ilk = await sahteRandevu(1, '+905991110001', CIHAZ);

    await request(app).post(`${BASE}/${ilk.id}/cancel-siblings`).set(auth(adminToken)).send({});

    const slots = await request(app)
      .get(`${BASE}/slots`)
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: ileriGun(1) })
      .set(auth(adminToken));

    const labels = slots.body.slots.map((s: { label: string }) => s.label);
    expect(labels).toContain('09:00');
  });

  it('cihaz özeti olmayan randevunun kardeşi yoktur', async () => {
    // Panelden girilen randevularda cihaz özeti bulunmaz; araç onlara
    // yanlışlıkla dokunmamalı.
    const panelRandevusu = await createAppointment({
      shopId: fx.shopId,
      barberId: fx.adminId,
      serviceIds: [fx.serviceId],
      startsAt: zonedTimeToUtc(ileriGun(5), '09:00', TZ),
      customerName: 'Panel Müşterisi',
      source: 'panel',
    });

    const res = await request(app)
      .get(`${BASE}/${panelRandevusu.id}/siblings`)
      .set(auth(adminToken));

    expect(res.body.items).toHaveLength(0);
  });

  it('staff başka berberin randevusunu toplu iptalle silemez', async () => {
    const firatinki = await sahteRandevu(1, '+905991110001', CIHAZ, fx.staffId);
    await sahteRandevu(2, '+905991110002', CIHAZ, fx.adminId);

    const res = await request(app)
      .post(`${BASE}/${firatinki.id}/cancel-siblings`)
      .set(auth(staffToken))
      .send({});

    expect(res.status).toBe(200);
    // Yalnızca kendi randevusu iptal edilmeli
    expect(res.body.cancelled).toBe(1);

    const muslumunki = await testPrisma.appointment.findFirst({
      where: { shopId: fx.shopId, barberId: fx.adminId, clientHash: CIHAZ },
    });
    expect(muslumunki?.status).toBe('confirmed');
  });
});

/**
 * Hizmet ekleme (POST /services).
 *
 * Berber panelden yeni bir hizmet ("Kaş Alma" gibi) ekleyebilmeli ve bu
 * hizmet müşteri sitesinde anında görünmeli.
 */
describe('POST /services — yeni hizmet ekleme', () => {
  // ⚠️ Dış beforeEach yalnızca randevuları siliyor. Bu blok hizmet
  // OLUŞTURUYOR; temizlenmezse ilk testin eklediği hizmet sonrakilerde
  // isim çakışmasına yol açıyor ve testler YANLIŞ SEBEPLE geçiyor
  // (ilk yazımda tam olarak bu oldu: 3 test aslında hiç ekleme yapmadan
  // 'geçiyordu'). Fixture hizmeti korunuyor, gerisi siliniyor.
  beforeEach(async () => {
    await testPrisma.service.deleteMany({
      where: { shopId: fx.shopId, id: { not: fx.serviceId } },
    });
  });

  it('admin yeni hizmet ekleyebilir', async () => {
    const res = await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name: 'Kaş Alma', durationMin: 30, price: 100 });

    expect(res.status).toBe(201);
    expect(res.body.service.name).toBe('Kaş Alma');
    expect(res.body.service.durationMin).toBe(30);
    expect(Number(res.body.service.price)).toBe(100);
  });

  it('eklenen hizmet müşteri sitesinde görünür', async () => {
    await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name: 'Kaş Alma', durationMin: 30, price: 100 });

    process.env.PUBLIC_SHOP_ID = fx.shopId;
    const res = await request(app).get('/api/v1/public/shop');
    delete process.env.PUBLIC_SHOP_ID;

    const isimler = res.body.services.map((x: { name: string }) => x.name);
    expect(isimler).toContain('Kaş Alma');
  });

  it('listenin SONUNA eklenir, mevcut sıra bozulmaz', async () => {
    const oncekiler = await request(app).get('/api/v1/services').set(auth(adminToken));
    const ilkIsim = oncekiler.body.services[0].name;

    await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name: 'Kaş Alma', durationMin: 30, price: 100 });

    const sonra = await request(app).get('/api/v1/services').set(auth(adminToken));
    expect(sonra.body.services[0].name).toBe(ilkIsim);
    expect(sonra.body.services.at(-1).name).toBe('Kaş Alma');
  });

  it('aynı isimde ikinci hizmeti REDDEDER', async () => {
    await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name: 'Kaş Alma', durationMin: 30, price: 100 });

    // Büyük/küçük harf farkı da aynı sayılmalı — müşteri listede iki
    // "kaş alma" görürse hangisini seçeceğini bilemez.
    const res = await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name: 'kaş alma', durationMin: 45, price: 120 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERVICE_NAME_TAKEN');
  });

  it('staff hizmet ekleyemez', async () => {
    const res = await request(app)
      .post('/api/v1/services')
      .set(auth(staffToken))
      .send({ name: 'İzinsiz Hizmet', durationMin: 30, price: 100 });

    expect(res.status).toBe(403);
  });

  it('fiyatsız hizmet eklenebilir', async () => {
    const res = await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name: 'Fiyatsız Hizmet', durationMin: 30 });

    expect(res.status).toBe(201);
    expect(res.body.service.price).toBeNull();
  });

  it('geçersiz süreyi reddeder', async () => {
    const res = await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name: 'Çok Kısa', durationMin: 1, price: 100 });

    expect(res.status).toBe(400);
  });

  it('yeni hizmetin kendi süresine göre saat ızgarası üretilir', async () => {
    // 30 dakikalık hizmet, 45 dakikalıktan FARKLI sayıda slot vermeli —
    // slot motoru süreyi hizmetten okuyor.
    const yeni = await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name: 'Kaş Alma', durationMin: 30, price: 100 });

    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId, serviceId: yeni.body.service.id, date: TEST_DATE });

    expect(res.status).toBe(200);
    expect(res.body.slots.length).toBeGreaterThan(0);
  });
});

/**
 * Hizmet kaldırma (DELETE /services/:id).
 *
 * İki farklı davranış var ve ayrımı korumak önemli: hiç kullanılmamış
 * hizmet gerçekten silinir, randevusu olan yalnızca gizlenir. İkincisi
 * olmazsa geçmiş randevular hangi hizmete ait olduğunu kaybeder.
 */
describe('DELETE /services/:id — hizmet kaldırma', () => {
  beforeEach(async () => {
    await testPrisma.service.deleteMany({
      where: { shopId: fx.shopId, id: { not: fx.serviceId } },
    });
    // Fixture hizmeti testler arasında pasife düşmüş olabilir
    await testPrisma.service.update({
      where: { id: fx.serviceId },
      data: { isActive: true },
    });
  });

  async function hizmetEkle(name = 'Kaş Alma') {
    const res = await request(app)
      .post('/api/v1/services')
      .set(auth(adminToken))
      .send({ name, durationMin: 30, price: 100 });
    return res.body.service;
  }

  it('hiç kullanılmamış hizmeti GERÇEKTEN siler', async () => {
    const h = await hizmetEkle();

    const res = await request(app)
      .delete(`/api/v1/services/${h.id}`)
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('deleted');

    const kalan = await testPrisma.service.findUnique({ where: { id: h.id } });
    expect(kalan).toBeNull();
  });

  it('randevusu olan hizmeti silmez, GİZLER', async () => {
    const h = await hizmetEkle();

    await createAppointment({
      shopId: fx.shopId,
      barberId: fx.adminId,
      serviceIds: [h.id],
      startsAt: zonedTimeToUtc(TEST_DATE, '09:00', TZ),
      customerName: 'Kaş Müşterisi',
      source: 'panel',
    });

    const res = await request(app)
      .delete(`/api/v1/services/${h.id}`)
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hidden');
    expect(res.body.appointmentCount).toBe(1);

    const kayit = await testPrisma.service.findUnique({ where: { id: h.id } });
    expect(kayit).not.toBeNull();
    expect(kayit?.isActive).toBe(false);
  });

  it('gizlenen hizmetin geçmiş randevusu hâlâ okunabilir', async () => {
    // Asıl mesele bu: berber geçmişte ne yaptığını görebilmeli.
    const h = await hizmetEkle();

    const randevu = await createAppointment({
      shopId: fx.shopId,
      barberId: fx.adminId,
      serviceIds: [h.id],
      startsAt: zonedTimeToUtc(TEST_DATE, '09:00', TZ),
      customerName: 'Kaş Müşterisi',
      source: 'panel',
    });

    await request(app).delete(`/api/v1/services/${h.id}`).set(auth(adminToken));

    const res = await request(app)
      .get(`${BASE}/${randevu.id}`)
      .set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.appointment.service.name).toBe('Kaş Alma');
  });

  it('gizlenen hizmet müşteri sitesinde GÖRÜNMEZ', async () => {
    const h = await hizmetEkle();
    await request(app).delete(`/api/v1/services/${h.id}`).set(auth(adminToken));

    process.env.PUBLIC_SHOP_ID = fx.shopId;
    const res = await request(app).get('/api/v1/public/shop');
    delete process.env.PUBLIC_SHOP_ID;

    const isimler = res.body.services.map((x: { name: string }) => x.name);
    expect(isimler).not.toContain('Kaş Alma');
  });

  it('SON aktif hizmeti kaldırmayı reddeder', async () => {
    // Hizmetsiz dükkanda randevu alınamaz ve panel saat ızgarası hesaplayamaz.
    const res = await request(app)
      .delete(`/api/v1/services/${fx.serviceId}`)
      .set(auth(adminToken));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_SERVICE');

    const kayit = await testPrisma.service.findUnique({ where: { id: fx.serviceId } });
    expect(kayit?.isActive).toBe(true);
  });

  it('staff hizmet kaldıramaz', async () => {
    const h = await hizmetEkle();

    const res = await request(app)
      .delete(`/api/v1/services/${h.id}`)
      .set(auth(staffToken));

    expect(res.status).toBe(403);

    const kayit = await testPrisma.service.findUnique({ where: { id: h.id } });
    expect(kayit).not.toBeNull();
  });

  it('başka dükkanın hizmetini kaldıramaz', async () => {
    const res = await request(app)
      .delete('/api/v1/services/00000000-0000-4000-8000-000000000000')
      .set(auth(adminToken));

    expect(res.status).toBe(404);
  });
});

/**
 * Geçmiş saatlerin gün görünümünde gösterilmesi.
 *
 * Berber saat 18:45'te dükkandayken sabah 09:00'da kimin geldiğini
 * görebilmeli. Slot motoru geçmiş saatleri eliyordu ve o saatlerdeki
 * randevular da ekrandan kayboluyordu — berber "randevular silindi" sandı.
 *
 * ⚠️ Bu değişikliğin TEHLİKELİ tarafı geçmişe randevu yazılabilir hale
 * gelmesiydi. Aşağıdaki testler bunun OLMADIĞINI kilitliyor.
 */
describe('Geçmiş saatler — gün görünümü', () => {
  /** Bugün, saat çoktan geçmiş bir slot. */
  function bugunLocal(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  }

  it('panel gün görünümü geçmiş saatleri DE döner ve işaretler', async () => {
    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: bugunLocal() });

    expect(res.status).toBe(200);

    // Gün başındaki 09:00 saatinin listede olması gerekiyor (bugün için
    // testin çalıştığı saat ne olursa olsun gün 09:00'da başlıyor).
    const etiketler = res.body.slots.map((x: { label: string }) => x.label);
    expect(etiketler).toContain('09:00');
  });

  it('geçmiş slotlar isPast=true ile işaretli gelir', async () => {
    const res = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId, serviceId: fx.serviceId, date: bugunLocal() });

    const gecmisler = res.body.slots.filter((x: { isPast: boolean }) => x.isPast);
    const gelecekler = res.body.slots.filter((x: { isPast: boolean }) => !x.isPast);

    // En az biri geçmiş olmalı — gün 09:00'da başlıyor ve testler gündüz
    // çalışıyor. İkisinin de var olması işaretlemenin gerçekten
    // hesaplandığını gösteriyor (hepsine true/false basılmıyor).
    expect(gecmisler.length + gelecekler.length).toBe(res.body.slots.length);
    expect(res.body.slots.length).toBeGreaterThan(0);
  });

  it('GEÇMİŞ saate randevu YAZILAMAZ (asıl güvence)', async () => {
    const gecmisSaat = zonedTimeToUtc(bugunLocal(), '09:00', TZ);

    // Saat gerçekten geçmişte mi? Değilse test anlamsız olur.
    if (gecmisSaat.getTime() >= Date.now()) {
      // Test gece yarısı ile 09:45 arasında çalışıyorsa atla.
      return;
    }

    await expect(
      createAppointment({
        shopId: fx.shopId,
        barberId: fx.adminId,
        serviceIds: [fx.serviceId],
        startsAt: gecmisSaat,
        customerName: 'Geçmiş Randevu Denemesi',
        source: 'panel',
      }),
    ).rejects.toThrow(/müsait değil/i);
  });

  it('MÜŞTERİ tarafı geçmiş saatleri GÖRMEZ', async () => {
    // Site tarafı değişmemeli: müşteriye geçmiş saat gösterilirse
    // seçer ve hata alır.
    process.env.PUBLIC_SHOP_ID = fx.shopId;
    const res = await request(app).get('/api/v1/public/slots').query({
      barberId: fx.adminId,
      serviceId: fx.serviceId,
      date: bugunLocal(),
    });
    delete process.env.PUBLIC_SHOP_ID;

    const gecmisVar = res.body.slots.some((x: { isPast?: boolean }) => x.isPast);
    expect(gecmisVar).toBe(false);

    // 09:00 geçmişteyse müşteri listesinde HİÇ olmamalı
    const gecmisSaat = zonedTimeToUtc(bugunLocal(), '09:00', TZ);
    if (gecmisSaat.getTime() < Date.now()) {
      const etiketler = res.body.slots.map((x: { label: string }) => x.label);
      expect(etiketler).not.toContain('09:00');
    }
  });
});

/**
 * ══════════════════════════════════════════════════════════════════
 *  ÇOKLU HİZMET
 * ══════════════════════════════════════════════════════════════════
 *
 * Kuralın tamamı burada kanıtlanıyor:
 *   * Aynı oturumda yapılabilen iki hizmet süreyi UZATMAZ.
 *   * "Ayrı zaman isteyen" hizmet, yanında başka hizmet varken uzatır.
 *   * Ama tek başına seçilirse uzatmaz.
 *
 * Süre birim testlerde de var (packages/shared); buradaki testler o kuralın
 * gerçekten VERİTABANINA yazıldığını, yani `endsAt` ile takvimin uyuştuğunu
 * gösteriyor. İkisi ayrışırsa slotlar yanlış hesaplanır ve randevular üst
 * üste biner.
 */
describe('Çoklu hizmet', () => {
  /**
   * Ek hizmetler BU BLOĞA ait — ortak fixture'a konmadı.
   *
   * Konulduğunda, dükkanda kaç hizmet olduğuna dayanan testler ("son aktif
   * hizmeti kaldırmayı reddeder") sessizce anlamsızlaştı: kural hiç
   * tetiklenmediği halde test geçmeye devam etti.
   */
  let ekHizmetId: string;
  let ayriZamanHizmetId: string;

  beforeAll(async () => {
    const [ek, ayri] = await Promise.all([
      testPrisma.service.create({
        data: { shopId: fx.shopId, name: 'Çoklu Ek Hizmet', durationMin: 45, sortOrder: 20 },
      }),
      testPrisma.service.create({
        data: {
          shopId: fx.shopId,
          name: 'Çoklu Ayrı Zaman',
          durationMin: 45,
          sortOrder: 21,
          requiresOwnSlot: true,
        },
      }),
    ]);
    ekHizmetId = ek.id;
    ayriZamanHizmetId = ayri.id;
  });

  function dakikaFarki(startsAt: string, endsAt: string): number {
    return (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000;
  }

  it('iki hizmet seçmek randevu süresini uzatmaz', async () => {
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        barberId: fx.adminId,
        serviceIds: [fx.serviceId, ekHizmetId],
        startsAt: slotAt('10:30'),
        customerName: 'Çift Hizmet',
      });

    expect(res.status).toBe(201);
    expect(dakikaFarki(res.body.appointment.startsAt, res.body.appointment.endsAt)).toBe(45);

    // Her iki hizmet de randevuya bağlanmış olmalı — biri sessizce
    // düşseydi berber müşterinin ağda da istediğini hiç göremezdi.
    const adlar = res.body.appointment.services.map((s: { name: string }) => s.name);
    expect(adlar).toEqual(['Test Hizmet', 'Çoklu Ek Hizmet']);
  });

  it('"ayrı zaman isteyen" hizmet eklendiğinde randevu iki slot kaplar', async () => {
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        barberId: fx.adminId,
        serviceIds: [fx.serviceId, ayriZamanHizmetId],
        startsAt: slotAt('10:30'),
        customerName: 'Lazer Müşterisi',
      });

    expect(res.status).toBe(201);
    expect(dakikaFarki(res.body.appointment.startsAt, res.body.appointment.endsAt)).toBe(90);
  });

  it('"ayrı zaman isteyen" hizmet TEK BAŞINA seçilirse randevuyu uzatmaz', async () => {
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        barberId: fx.adminId,
        serviceIds: [ayriZamanHizmetId],
        startsAt: slotAt('10:30'),
        customerName: 'Yalnız Lazer',
      });

    expect(res.status).toBe(201);
    expect(dakikaFarki(res.body.appointment.startsAt, res.body.appointment.endsAt)).toBe(45);
  });

  it('90 dakikalık randevu, sonraki slotu da gerçekten kapatır', async () => {
    // Asıl mesele bu: süre yalnızca ekranda değil, takvimde de uzamalı.
    await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        barberId: fx.adminId,
        serviceIds: [fx.serviceId, ayriZamanHizmetId],
        startsAt: slotAt('10:30'),
        customerName: 'Uzun Randevu',
      })
      .expect(201);

    // 10:30 + 90 dk = 12:00. Izgara 09:00'dan 45'er dakika ilerlediği için
    // 11:15 başlangıcı bu randevunun içinde kalıyor ve alınamamalı.
    const cakisan = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        barberId: fx.adminId,
        serviceIds: [fx.serviceId],
        startsAt: slotAt('11:15'),
        customerName: 'Çakışan',
      });

    expect(cakisan.status).toBe(409);
  });

  it('saat listesi seçilen hizmetlere göre daralır', async () => {
    // Uzun bir randevu için gün sonuna yakın başlangıçlar sığmaz; kısa
    // randevu için sığar. Aynı gün, aynı berber, tek fark hizmet kümesi.
    const tek = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({ barberId: fx.adminId, serviceIds: fx.serviceId, date: TEST_DATE });

    const cift = await request(app)
      .get(`${BASE}/slots`)
      .set(auth(adminToken))
      .query({
        barberId: fx.adminId,
        serviceIds: `${fx.serviceId},${ayriZamanHizmetId}`,
        date: TEST_DATE,
      });

    expect(tek.status).toBe(200);
    expect(cift.status).toBe(200);
    expect(cift.body.slots.length).toBeLessThan(tek.body.slots.length);
  });

  it('eski istemcinin gönderdiği tekil serviceId hâlâ kabul edilir', async () => {
    // Telefondaki önbelleğe alınmış eski panel/site sürümü bir süre daha
    // bu biçimi gönderiyor; reddedilseydi güncelleme anında randevu
    // alınamaz olurdu.
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        barberId: fx.adminId,
        serviceId: fx.serviceId,
        startsAt: slotAt('12:00'),
        customerName: 'Eski İstemci',
      });

    expect(res.status).toBe(201);
    expect(res.body.appointment.services).toHaveLength(1);
  });

  it('hizmetsiz randevu reddedilir', async () => {
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        barberId: fx.adminId,
        serviceIds: [],
        startsAt: slotAt('13:00'),
        customerName: 'Hizmetsiz',
      });

    expect(res.status).toBe(400);
  });

  it('saati değiştirilen çok hizmetli randevu süresini korur', async () => {
    const olustur = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        barberId: fx.adminId,
        serviceIds: [fx.serviceId, ayriZamanHizmetId],
        startsAt: slotAt('10:30'),
        customerName: 'Ertelenen',
      })
      .expect(201);

    const res = await request(app)
      .post(`${BASE}/${olustur.body.appointment.id}/reschedule`)
      .set(auth(adminToken))
      .send({ startsAt: slotAt('14:15') });

    expect(res.status).toBe(200);
    // Süre randevunun ANA hizmetinden değil, kümesinin tamamından
    // hesaplanmalı; aksi halde 90 dakikalık randevu 45 dakikaya düşerdi.
    expect(dakikaFarki(res.body.appointment.startsAt, res.body.appointment.endsAt)).toBe(90);
  });
});
