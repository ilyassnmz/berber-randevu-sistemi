import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';

/**
 * Berber yönetimi: çalışma saatleri, izin günleri, yeni berber ekleme.
 *
 * `working_hours`/`time_off` tabloları vardı ama hiçbir route bunları
 * yazmıyordu — bu dosya o boşluğu kapatan uçları doğruluyor.
 */

const app = createApp();
const BASE = '/api/v1/barbers';

let fx: TestFixture;
let adminToken: string;
let staffToken: string;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function fullWeek(overrides: Partial<{ startTime: string; endTime: string }> = {}) {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    startTime: overrides.startTime ?? '09:00',
    endTime: overrides.endTime ?? '20:15',
    isWorking: dayOfWeek !== 0,
  }));
}

beforeAll(async () => {
  fx = await createFixture();

  const adminRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: fx.adminEmail, password: fx.password });
  adminToken = adminRes.body.accessToken as string;

  const staffRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: fx.staffEmail, password: fx.password });
  staffToken = staffRes.body.accessToken as string;
});

afterAll(async () => {
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
});

describe('Çalışma saatleri', () => {
  it('staff kendi saatlerini görüntüleyip güncelleyebilir', async () => {
    const put = await request(app)
      .put(`${BASE}/${fx.staffId}/working-hours`)
      .set(auth(staffToken))
      .send(fullWeek({ startTime: '10:00', endTime: '18:00' }));

    expect(put.status).toBe(200);
    expect(put.body.workingHours).toHaveLength(7);
    expect(put.body.workingHours[1].startTime).toBe('10:00');

    const get = await request(app).get(`${BASE}/${fx.staffId}/working-hours`).set(auth(staffToken));
    expect(get.status).toBe(200);
    expect(get.body.workingHours[1].startTime).toBe('10:00');
  });

  it('staff başka berberin saatlerini değiştiremez', async () => {
    const res = await request(app)
      .put(`${BASE}/${fx.adminId}/working-hours`)
      .set(auth(staffToken))
      .send(fullWeek());

    expect(res.status).toBe(403);
  });

  it('admin herkesin saatlerini değiştirebilir', async () => {
    const res = await request(app)
      .put(`${BASE}/${fx.staffId}/working-hours`)
      .set(auth(adminToken))
      .send(fullWeek({ startTime: '09:00', endTime: '20:15' }));

    expect(res.status).toBe(200);
    expect(res.body.workingHours[1].startTime).toBe('09:00');
  });

  it('7 günden eksik gönderilirse reddeder', async () => {
    const res = await request(app)
      .put(`${BASE}/${fx.staffId}/working-hours`)
      .set(auth(staffToken))
      .send(fullWeek().slice(0, 6));

    expect(res.status).toBe(400);
  });
});

describe('İzin günleri', () => {
  it('staff kendi izin gününü ekleyip listeleyip silebilir', async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const dayAfter = new Date(Date.now() + 48 * 3600_000);

    const created = await request(app)
      .post(`${BASE}/${fx.staffId}/time-off`)
      .set(auth(staffToken))
      .send({ startsAt: tomorrow.toISOString(), endsAt: dayAfter.toISOString(), reason: 'İzin' });

    expect(created.status).toBe(201);
    expect(created.body.timeOff.barberId).toBe(fx.staffId);

    const list = await request(app).get(`${BASE}/${fx.staffId}/time-off`).set(auth(staffToken));
    expect(list.body.timeOff.some((t: { id: string }) => t.id === created.body.timeOff.id)).toBe(
      true,
    );

    const del = await request(app)
      .delete(`${BASE}/time-off/${created.body.timeOff.id}`)
      .set(auth(staffToken));
    expect(del.status).toBe(204);

    const listAfter = await request(app).get(`${BASE}/${fx.staffId}/time-off`).set(auth(staffToken));
    expect(listAfter.body.timeOff.some((t: { id: string }) => t.id === created.body.timeOff.id)).toBe(
      false,
    );
  });

  it('staff başkasının izin gününü ekleyemez', async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const dayAfter = new Date(Date.now() + 48 * 3600_000);

    const res = await request(app)
      .post(`${BASE}/${fx.adminId}/time-off`)
      .set(auth(staffToken))
      .send({ startsAt: tomorrow.toISOString(), endsAt: dayAfter.toISOString(), reason: 'İzin' });

    expect(res.status).toBe(403);
  });

  it('izinli günde slot listelenmez (uçtan uca doğrulama)', async () => {
    // Pazar hariç herhangi bir gün — Pazar zaten kapalı, izin testini anlamsız kılar.
    let target = new Date(Date.now() + 24 * 3600_000);
    while (target.getUTCDay() === 0) target = new Date(target.getTime() + 24 * 3600_000);
    const targetDate = target.toISOString().slice(0, 10);
    const dayStart = new Date(`${targetDate}T00:00:00+03:00`);
    const dayEnd = new Date(`${targetDate}T23:59:59+03:00`);

    await request(app)
      .post(`${BASE}/${fx.staffId}/time-off`)
      .set(auth(staffToken))
      .send({ startsAt: dayStart.toISOString(), endsAt: dayEnd.toISOString(), reason: 'Tam gün izin' });

    const service = await testPrisma.service.findFirstOrThrow({ where: { shopId: fx.shopId } });
    const slots = await request(app)
      .get('/api/v1/appointments/slots')
      .set(auth(staffToken))
      .query({ barberId: fx.staffId, serviceId: service.id, date: targetDate });

    expect(slots.body.slots).toHaveLength(0);
  });
});

describe('POST /barbers — yeni berber ekleme', () => {
  it('yöneticinin belirlediği şifreyle eklenen berber GİRİŞ YAPABİLİR', async () => {
    // Bu testin asıl işi bu satır: eklenen berber panele girebilmeli.
    // Canlıda kırılan tam olarak buydu — berber eklendi ama giremedi, çünkü
    // sistemin ürettiği şifre bir kez gösterilip kayboluyordu.
    const email = `yeni-${Date.now()}@test.local`;
    const sifre = 'berber-sifre-2026';

    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({ name: 'Yeni Berber', email, password: sifre, role: 'staff' });

    expect(res.status).toBe(201);
    expect(res.body.barber.email).toBe(email);

    // ⚠️ Şifre yanıtta DÖNMEMELİ: gönderen zaten biliyor, ağda ikinci kez
    // dolaşmasının bir faydası yok.
    expect(res.body.password).toBeUndefined();

    const hours = await testPrisma.workingHours.findMany({ where: { barberId: res.body.barber.id } });
    expect(hours).toHaveLength(7);
    expect(hours.find((h) => h.dayOfWeek === 0)?.isWorking).toBe(false);
    expect(hours.find((h) => h.dayOfWeek === 1)?.isWorking).toBe(true);

    const login = await request(app).post('/api/v1/auth/login').send({ email, password: sifre });
    expect(login.status).toBe(200);
    expect(login.body.barber.email).toBe(email);

    await testPrisma.workingHours.deleteMany({ where: { barberId: res.body.barber.id } });
    await testPrisma.refreshToken.deleteMany({ where: { barberId: res.body.barber.id } });
    await testPrisma.barber.delete({ where: { id: res.body.barber.id } });
  });

  it('çok kısa şifre reddedilir', async () => {
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        name: 'Zayıf Şifre',
        email: `zayif-${Date.now()}@test.local`,
        password: '123',
        role: 'staff',
      });

    expect(res.status).toBe(400);
  });

  it('şifresiz istek reddedilir', async () => {
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({ name: 'Şifresiz', email: `sifresiz-${Date.now()}@test.local`, role: 'staff' });

    expect(res.status).toBe(400);
  });

  it('staff yeni berber ekleyemez', async () => {
    const res = await request(app)
      .post(BASE)
      .set(auth(staffToken))
      .send({
        name: 'Yeni Berber 2',
        email: `yeni2-${Date.now()}@test.local`,
        password: 'berber-sifre-2026',
        role: 'staff',
      });

    expect(res.status).toBe(403);
  });

  it('aynı e-posta ile ikinci berber eklenemez', async () => {
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({ name: 'Tekrar', email: fx.staffEmail, password: 'berber-sifre-2026', role: 'staff' });

    expect(res.status).toBe(400);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════
 *  BERBER DÜZENLEME VE KAPATMA
 * ══════════════════════════════════════════════════════════════════
 *
 * Bu bloğun asıl işi düzenlemenin çalıştığını göstermek DEĞİL — üç korumanın
 * çalıştığını göstermek. Üçü de "çalışan sistemi bozmama" amacında ve
 * üçünün de bozulması sessiz olur:
 *
 *   * Son yönetici kapatılırsa dükkan yönetilemez hale gelir.
 *   * Kendini kapatan admin panelden düşer.
 *   * Gelecek randevusu olan berber kapatılırsa, sekmesi kaybolduğu için
 *     o randevular PANELDE GÖRÜNMEZ olur — müşteri kapıya gelir, kayıt yoktur.
 */
describe('PUT /barbers/:id — düzenleme ve kapatma', () => {
  it('admin, berberin adını ve yetkisini değiştirebilir', async () => {
    const res = await request(app)
      .put(`${BASE}/${fx.staffId}`)
      .set(auth(adminToken))
      .send({ name: 'Fırat Usta', role: 'staff', isActive: true });

    expect(res.status).toBe(200);
    expect(res.body.barber.name).toBe('Fırat Usta');

    // Geri al — sonraki testler fixture adını bekliyor olabilir
    await request(app)
      .put(`${BASE}/${fx.staffId}`)
      .set(auth(adminToken))
      .send({ name: 'Test Çalışan', role: 'staff', isActive: true });
  });

  it('staff başka berberi düzenleyemez', async () => {
    const res = await request(app)
      .put(`${BASE}/${fx.adminId}`)
      .set(auth(staffToken))
      .send({ name: 'Ele Geçirme', role: 'admin', isActive: true });

    expect(res.status).toBe(403);
  });

  it('SON yönetici kapatılamaz', async () => {
    const res = await request(app)
      .put(`${BASE}/${fx.adminId}`)
      .set(auth(adminToken))
      .send({ name: 'Test Yönetici', role: 'admin', isActive: false });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/son yöneticiyi/i);
  });

  it('SON yöneticinin yetkisi alınamaz', async () => {
    const res = await request(app)
      .put(`${BASE}/${fx.adminId}`)
      .set(auth(adminToken))
      .send({ name: 'Test Yönetici', role: 'staff', isActive: true });

    expect(res.status).toBe(400);
  });

  it('admin kendi hesabını kapatamaz (ikinci yönetici olsa bile)', async () => {
    // Önce ikinci bir yönetici oluştur ki "son yönetici" kuralı devreye girmesin
    await request(app)
      .put(`${BASE}/${fx.staffId}`)
      .set(auth(adminToken))
      .send({ name: 'Test Çalışan', role: 'admin', isActive: true })
      .expect(200);

    const res = await request(app)
      .put(`${BASE}/${fx.adminId}`)
      .set(auth(adminToken))
      .send({ name: 'Test Yönetici', role: 'admin', isActive: false });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/kendi hesabınızı/i);

    // Eski haline döndür
    await request(app)
      .put(`${BASE}/${fx.staffId}`)
      .set(auth(adminToken))
      .send({ name: 'Test Çalışan', role: 'staff', isActive: true })
      .expect(200);
  });

  it('GELECEK randevusu olan berber kapatılamaz', async () => {
    const gelecek = new Date();
    gelecek.setUTCDate(gelecek.getUTCDate() + 3);
    gelecek.setUTCHours(9, 0, 0, 0);

    const randevu = await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.staffId,
        customerId: fx.customerId,
        serviceId: fx.serviceId,
        startsAt: gelecek,
        endsAt: new Date(gelecek.getTime() + 45 * 60_000),
        status: 'confirmed',
        source: 'panel',
      },
    });

    try {
      const res = await request(app)
        .put(`${BASE}/${fx.staffId}`)
        .set(auth(adminToken))
        .send({ name: 'Test Çalışan', role: 'staff', isActive: false });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/gelecek randevu/i);

      // Berber HÂLÂ aktif olmalı — kural reddetmiş olmalı, yarım uygulamamış
      const kayit = await testPrisma.barber.findUnique({ where: { id: fx.staffId } });
      expect(kayit?.isActive).toBe(true);
    } finally {
      await testPrisma.appointment.delete({ where: { id: randevu.id } });
    }
  });

  it('gelecek randevusu olmayan berber kapatılıp tekrar açılabilir', async () => {
    const kapat = await request(app)
      .put(`${BASE}/${fx.staffId}`)
      .set(auth(adminToken))
      .send({ name: 'Test Çalışan', role: 'staff', isActive: false });

    expect(kapat.status).toBe(200);
    expect(kapat.body.barber.isActive).toBe(false);

    // Kapalı berber takvim listesinden düşmeli...
    const aktifler = await request(app).get(BASE).set(auth(adminToken)).expect(200);
    expect(aktifler.body.barbers.map((b: { id: string }) => b.id)).not.toContain(fx.staffId);

    // ...ama yönetim listesinde durmalı, yoksa geri açılamaz
    const hepsi = await request(app).get(`${BASE}/all`).set(auth(adminToken)).expect(200);
    expect(hepsi.body.barbers.map((b: { id: string }) => b.id)).toContain(fx.staffId);

    const ac = await request(app)
      .put(`${BASE}/${fx.staffId}`)
      .set(auth(adminToken))
      .send({ name: 'Test Çalışan', role: 'staff', isActive: true });

    expect(ac.status).toBe(200);
    expect(ac.body.barber.isActive).toBe(true);
  });

  it('staff yönetim listesini göremez', async () => {
    const res = await request(app).get(`${BASE}/all`).set(auth(staffToken));
    expect(res.status).toBe(403);
  });
});

/**
 * Berber kaldırma.
 *
 * Hizmet kaldırmadaki ayrımın aynısı: hiç kullanılmamış kayıt gerçekten
 * silinir, kullanılmış olan yalnızca kapatılır. İlk sürümde bu ayrım yoktu
 * ve deneme amaçlı eklenen bir berber yönetim listesinden hiç kaybolmuyordu.
 */
describe('DELETE /barbers/:id — kaldırma', () => {
  async function berberEkle(ad: string) {
    const res = await request(app)
      .post(BASE)
      .set(auth(adminToken))
      .send({
        name: ad,
        email: `sil-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`,
        password: 'berber-sifre-2026',
        role: 'staff',
      });
    expect(res.status).toBe(201);
    return res.body.barber.id as string;
  }

  it('hiç randevusu olmayan berber GERÇEKTEN silinir', async () => {
    const id = await berberEkle('Silinecek Berber');

    const res = await request(app).delete(`${BASE}/${id}`).set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('deleted');

    // Kayıt gerçekten gitmiş olmalı — "kapatıldı" değil
    const kayit = await testPrisma.barber.findUnique({ where: { id } });
    expect(kayit).toBeNull();

    // Çalışma saatleri de birlikte silinmiş olmalı (şemada Cascade)
    const saatler = await testPrisma.workingHours.findMany({ where: { barberId: id } });
    expect(saatler).toHaveLength(0);
  });

  it('GEÇMİŞ randevusu olan berber silinmez, kapatılır', async () => {
    const id = await berberEkle('Geçmişi Olan');

    const gecmis = new Date();
    gecmis.setUTCDate(gecmis.getUTCDate() - 10);
    gecmis.setUTCHours(9, 0, 0, 0);

    await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: id,
        customerId: fx.customerId,
        serviceId: fx.serviceId,
        startsAt: gecmis,
        endsAt: new Date(gecmis.getTime() + 45 * 60_000),
        status: 'completed',
        source: 'panel',
      },
    });

    const res = await request(app).delete(`${BASE}/${id}`).set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hidden');
    expect(res.body.appointmentCount).toBe(1);

    const kayit = await testPrisma.barber.findUnique({ where: { id } });
    expect(kayit?.isActive).toBe(false);

    await testPrisma.appointment.deleteMany({ where: { barberId: id } });
    await testPrisma.workingHours.deleteMany({ where: { barberId: id } });
    await testPrisma.barber.delete({ where: { id } });
  });

  it('GELECEK randevusu olan berber kaldırılamaz', async () => {
    const id = await berberEkle('Geleceği Olan');

    const gelecek = new Date();
    gelecek.setUTCDate(gelecek.getUTCDate() + 5);
    gelecek.setUTCHours(9, 0, 0, 0);

    const randevu = await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: id,
        customerId: fx.customerId,
        serviceId: fx.serviceId,
        startsAt: gelecek,
        endsAt: new Date(gelecek.getTime() + 45 * 60_000),
        status: 'confirmed',
        source: 'panel',
      },
    });

    const res = await request(app).delete(`${BASE}/${id}`).set(auth(adminToken));

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/gelecek randevu/i);

    // Ne silinmiş ne kapatılmış olmalı
    const kayit = await testPrisma.barber.findUnique({ where: { id } });
    expect(kayit?.isActive).toBe(true);

    await testPrisma.appointment.delete({ where: { id: randevu.id } });
    await testPrisma.workingHours.deleteMany({ where: { barberId: id } });
    await testPrisma.barber.delete({ where: { id } });
  });

  it('admin kendi kaydını kaldıramaz', async () => {
    const res = await request(app).delete(`${BASE}/${fx.adminId}`).set(auth(adminToken));

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/kendi hesabınızı/i);
  });

  it('staff berber kaldıramaz', async () => {
    const res = await request(app).delete(`${BASE}/${fx.staffId}`).set(auth(staffToken));
    expect(res.status).toBe(403);
  });
});
