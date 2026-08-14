import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';

/**
 * Müşteri listesi/detayı — entegrasyon testleri.
 *
 * todo.md M3'te MVP kapsamında listelenmiş ama uzun süre hiçbir route bunu
 * karşılamıyordu (schemas.ts'teki listCustomersQuerySchema ölü kodtu).
 */

const app = createApp();
const BASE = '/api/v1/customers';

let fx: TestFixture;
let adminToken: string;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  fx = await createFixture();

  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: fx.adminEmail, password: fx.password });
  adminToken = res.body.accessToken as string;
});

afterAll(async () => {
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
});

describe('GET /customers', () => {
  it('jetonsuz erişimi reddeder', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });

  it('dükkanın müşterilerini listeler', async () => {
    const res = await request(app).get(BASE).set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.items.some((c: { id: string }) => c.id === fx.customerId)).toBe(true);
  });

  it('isme göre arar', async () => {
    const res = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ search: 'Test Müşteri' });

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((c: { name: string }) => c.name.includes('Test Müşteri'))).toBe(
      true,
    );
  });

  it('alakasız aramada boş liste döner', async () => {
    const res = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ search: 'HiçKimseBuAdiTasimiyor' });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('yalnızca kara listedekileri filtreler', async () => {
    const blacklisted = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Kara Liste Müşterisi', isBlacklisted: true },
    });

    const res = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ blacklistedOnly: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.items.every((c: { isBlacklisted: boolean }) => c.isBlacklisted)).toBe(true);
    expect(res.body.items.some((c: { id: string }) => c.id === blacklisted.id)).toBe(true);
  });

  it('sayfalama yapar', async () => {
    for (let i = 0; i < 3; i++) {
      await testPrisma.customer.create({
        data: { shopId: fx.shopId, name: `Sayfalama Testi ${i}` },
      });
    }

    const page1 = await request(app).get(BASE).set(auth(adminToken)).query({ limit: 2 });
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get(BASE)
      .set(auth(adminToken))
      .query({ limit: 2, cursor: page1.body.nextCursor });
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
  });
});

describe('GET /customers/:id', () => {
  it('müşteri detayını randevu geçmişiyle döner', async () => {
    const service = await testPrisma.service.findFirstOrThrow({ where: { shopId: fx.shopId } });
    await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: fx.customerId,
        serviceId: service.id,
        startsAt: new Date(Date.now() + 3600_000),
        endsAt: new Date(Date.now() + 3600_000 + 45 * 60_000),
        status: 'confirmed',
        source: 'panel',
      },
    });

    const res = await request(app).get(`${BASE}/${fx.customerId}`).set(auth(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.customer.id).toBe(fx.customerId);
    expect(res.body.customer.appointments.length).toBeGreaterThan(0);
    expect(res.body.customer.appointments[0].service.name).toBeDefined();
  });

  it('başka dükkanın müşterisini 404 ile reddeder', async () => {
    const otherShop = await testPrisma.shop.create({
      data: { name: 'Başka Dükkan', slug: `other-${Date.now()}` },
    });
    const otherCustomer = await testPrisma.customer.create({
      data: { shopId: otherShop.id, name: 'Başka Müşteri' },
    });

    const res = await request(app).get(`${BASE}/${otherCustomer.id}`).set(auth(adminToken));
    expect(res.status).toBe(404);

    await testPrisma.customer.deleteMany({ where: { shopId: otherShop.id } });
    await testPrisma.shop.delete({ where: { id: otherShop.id } });
  });
});
