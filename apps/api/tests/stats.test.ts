import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';
import { zonedTimeToUtc } from '../src/lib/time.js';

/**
 * İstatistik ucu — özellikle yetki sınırını kanıtlıyor:
 * staff istemciden başka bir berberin kimliğini gönderse bile kendi
 * verisini görmeli (servis katmanı bunu zorluyor).
 */

const app = createApp();
const BASE = '/api/v1/stats';
const TZ = 'Europe/Istanbul';

let fx: TestFixture;
let adminToken: string;
let staffToken: string;

const DATE = futureFriday();

function futureFriday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seedAppointment(barberId: string, time: string, status: string) {
  const service = await testPrisma.service.findFirstOrThrow({ where: { shopId: fx.shopId } });
  const startsAt = zonedTimeToUtc(DATE, time, TZ);
  const customer = await testPrisma.customer.create({
    data: { shopId: fx.shopId, name: `İstatistik ${time}` },
  });
  return testPrisma.appointment.create({
    data: {
      shopId: fx.shopId,
      barberId,
      customerId: customer.id,
      serviceId: service.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      status,
      source: 'panel',
    },
  });
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

  await seedAppointment(fx.adminId, '09:00', 'completed');
  await seedAppointment(fx.adminId, '10:30', 'cancelled');
  await seedAppointment(fx.staffId, '12:00', 'completed');
  await seedAppointment(fx.staffId, '13:30', 'no_show');
});

afterAll(async () => {
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
});

describe('GET /stats', () => {
  it('jetonsuz erişimi reddeder', async () => {
    const res = await request(app).get(BASE).query({ from: DATE, to: DATE });
    expect(res.status).toBe(401);
  });

  it('admin tüm dükkanın toplamını görür', async () => {
    const res = await request(app).get(BASE).set(auth(adminToken)).query({ from: DATE, to: DATE });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.byStatus.completed).toBe(2);
    expect(res.body.byStatus.cancelled).toBe(1);
    expect(res.body.byStatus.no_show).toBe(1);
    expect(res.body.byBarber).toHaveLength(2);
  });

  it('admin tek bir berberi filtreleyebilir', async () => {
    const res = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ from: DATE, to: DATE, barberId: fx.staffId });

    expect(res.body.total).toBe(2);
    expect(res.body.byBarber).toHaveLength(1);
    expect(res.body.byBarber[0].barberId).toBe(fx.staffId);
  });

  it('staff BAŞKA berberin kimliğini gönderse bile kendi verisini görür', async () => {
    const res = await request(app)
      .get(BASE)
      .set(auth(staffToken))
      .query({ from: DATE, to: DATE, barberId: fx.adminId });

    expect(res.status).toBe(200);
    // admin'in 2 randevusu değil, kendi 2 randevusu dönmeli
    expect(res.body.byBarber).toHaveLength(1);
    expect(res.body.byBarber[0].barberId).toBe(fx.staffId);
  });

  it('kaynak (WhatsApp/panel) dağılımı döner', async () => {
    const res = await request(app).get(BASE).set(auth(adminToken)).query({ from: DATE, to: DATE });
    expect(res.body.bySource.panel).toBe(4);
    expect(res.body.bySource.whatsapp).toBe(0);
  });

  it('aralık dışındaki günü saymaz', async () => {
    const dayBefore = new Date(new Date(`${DATE}T00:00:00Z`).getTime() - 86400_000)
      .toISOString()
      .slice(0, 10);

    const res = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ from: dayBefore, to: dayBefore });

    expect(res.body.total).toBe(0);
  });

  it('ters tarih aralığını reddeder', async () => {
    const dayBefore = new Date(new Date(`${DATE}T00:00:00Z`).getTime() - 86400_000)
      .toISOString()
      .slice(0, 10);

    const res = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ from: DATE, to: dayBefore });

    expect(res.status).toBe(400);
  });
});
