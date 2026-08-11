import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isOverlapViolation } from '../src/lib/errors.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  ÇAKIŞMA KISITI — ENTEGRASYON TESTİ
 * ══════════════════════════════════════════════════════════════════
 *
 * Sistemin en kritik güvencesini GERÇEK veritabanına karşı kanıtlar:
 * aynı berbere çakışan randevu girilemez.
 *
 * Bu test birim testi olarak yazılamaz — kısıt PostgreSQL'in içinde
 * yaşıyor, uygulama kodunda değil. Sahte bir veritabanıyla test etmek,
 * tam da test edilmek istenen şeyi atlamak olurdu.
 *
 * Her test kendi izole dükkanını kurar ve sonunda temizler; başka
 * testlerin veya seed verisinin üzerine yazmaz.
 */

const prisma = new PrismaClient();

let shopId: string;
let barberAId: string;
let barberBId: string;
let customerId: string;
let serviceId: string;

/** 2026-08-12 Çarşamba 09:00 İstanbul = 06:00 UTC */
const T0900 = new Date('2026-08-12T06:00:00.000Z');
const T0945 = new Date('2026-08-12T06:45:00.000Z');
const T1030 = new Date('2026-08-12T07:30:00.000Z');
const T0920 = new Date('2026-08-12T06:20:00.000Z');
const T1005 = new Date('2026-08-12T07:05:00.000Z');

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);

  const shop = await prisma.shop.create({
    data: { name: `Test Dükkan ${suffix}`, slug: `test-${suffix}` },
  });
  shopId = shop.id;

  const [barberA, barberB] = await Promise.all([
    prisma.barber.create({
      data: {
        shopId,
        name: 'Test Berber A',
        email: `a-${suffix}@test.local`,
        passwordHash: 'test',
      },
    }),
    prisma.barber.create({
      data: {
        shopId,
        name: 'Test Berber B',
        email: `b-${suffix}@test.local`,
        passwordHash: 'test',
      },
    }),
  ]);
  barberAId = barberA.id;
  barberBId = barberB.id;

  const customer = await prisma.customer.create({
    data: { shopId, name: 'Test Müşteri', phone: `+9053${suffix.slice(0, 8)}` },
  });
  customerId = customer.id;

  const service = await prisma.service.create({
    data: { shopId, name: 'Test Hizmet', durationMin: 45 },
  });
  serviceId = service.id;
});

afterAll(async () => {
  // Sıra önemli: yabancı anahtarlar nedeniyle önce randevular
  if (shopId) {
    await prisma.appointment.deleteMany({ where: { shopId } });
    await prisma.shop.delete({ where: { id: shopId } }).catch(() => {
      // Cascade zaten temizlemiş olabilir
    });
  }
  await prisma.$disconnect();
});

function book(barberId: string, startsAt: Date, endsAt: Date, status = 'confirmed' as const) {
  return prisma.appointment.create({
    data: { shopId, barberId, customerId, serviceId, startsAt, endsAt, status },
  });
}

describe('appointments_no_overlap kısıtı', () => {
  it('kısıt ve btree_gist eklentisi veritabanında mevcut', async () => {
    const extensions = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'btree_gist'
    `;
    expect(extensions).toHaveLength(1);

    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conname = 'appointments_no_overlap'
    `;
    expect(constraints).toHaveLength(1);
  });

  it('aynı berbere birebir aynı saatte ikinci randevu girilemez', async () => {
    await book(barberAId, T0900, T0945);

    await expect(book(barberAId, T0900, T0945)).rejects.toSatisfy(isOverlapViolation);
  });

  it('kısmen çakışan randevu da reddedilir', async () => {
    // 09:20–10:05, mevcut 09:00–09:45 ile çakışıyor
    await expect(book(barberAId, T0920, T1005)).rejects.toSatisfy(isOverlapViolation);
  });

  it('bitişik randevu kabul edilir', async () => {
    // 09:45–10:30 — bir öncekinin bittiği anda başlıyor.
    // Aralık '[)' olarak tanımlandığı için çakışma sayılmaz.
    // Bu davranış olmasaydı her randevu bir sonrakini bloke ederdi.
    const adjacent = await book(barberAId, T0945, T1030);
    expect(adjacent.id).toBeTruthy();
  });

  it('farklı berber aynı saatte randevu alabilir', async () => {
    const other = await book(barberBId, T0900, T0945);
    expect(other.id).toBeTruthy();
  });

  it('iptal edilen randevu slotu serbest bırakır', async () => {
    // Kısıt yalnızca pending_confirm ve confirmed durumlarını kapsıyor.
    const target = await prisma.appointment.findFirst({
      where: { barberId: barberAId, startsAt: T0900, status: 'confirmed' },
    });
    expect(target).not.toBeNull();

    await prisma.appointment.update({
      where: { id: target!.id },
      data: { status: 'cancelled', cancelledBy: 'customer', cancelledAt: new Date() },
    });

    // Aynı slot artık yeniden alınabilmeli
    const rebooked = await book(barberAId, T0900, T0945);
    expect(rebooked.id).toBeTruthy();
  });

  it('eşzamanlı iki rezervasyondan tam olarak biri başarılı olur', async () => {
    // Asıl senaryo bu: iki müşteri aynı anda aynı saati seçiyor.
    // Uygulama seviyesinde "önce kontrol et sonra yaz" yaklaşımı burada
    // ikisini de geçirirdi; kısıt sayesinde yalnızca biri geçiyor.
    const slotStart = new Date('2026-08-12T11:00:00.000Z');
    const slotEnd = new Date('2026-08-12T11:45:00.000Z');

    const results = await Promise.allSettled([
      book(barberAId, slotStart, slotEnd),
      book(barberAId, slotStart, slotEnd),
      book(barberAId, slotStart, slotEnd),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);

    // Reddedilenlerin hepsi çakışma hatası olmalı — başka bir hata değil
    for (const r of rejected) {
      expect(isOverlapViolation((r as PromiseRejectedResult).reason)).toBe(true);
    }
  });
});
