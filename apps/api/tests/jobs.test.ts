import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createFixture, destroyFixture, testPrisma, type TestFixture } from './helpers.js';
import { sendDayReminders, sendHourReminders } from '../src/jobs/reminders.js';
import { expirePendingAppointments, cleanupExpired } from '../src/jobs/cleanup.js';
import { withJobLock } from '../src/jobs/lock.js';
import { FakeWhatsAppClient, setWhatsAppClient } from '../src/services/whatsapp/client.js';
import { prisma } from '../src/db/client.js';

/**
 * Cron işleri — entegrasyon testleri.
 *
 * En kritik olan: aynı işin AYNI ANDA iki kez çalışmaya çalışması
 * (örn. iki sunucu örneği aynı tick'i işlemeye kalkması) — job_locks
 * tablosu bunlardan yalnızca birinin çalışmasını garanti ediyor.
 */

const fake = new FakeWhatsAppClient();
let fx: TestFixture;

beforeAll(async () => {
  setWhatsAppClient(fake);
  fx = await createFixture();
});

afterAll(async () => {
  setWhatsAppClient(null);
  await destroyFixture(fx.shopId);
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  fake.clear();
  await testPrisma.appointment.deleteMany({ where: { shopId: fx.shopId } });
});

describe('withJobLock', () => {
  it('aynı işin eşzamanlı iki çalışmasından yalnızca biri işi yapar', async () => {
    // Prisma'nın havuzunda henüz ikinci bir bağlantı yoksa, o bağlantının
    // ilk kez kurulması (Neon üzerinde ~500ms+ sürebiliyor) ikinci çağrının
    // veritabanına GERÇEKTEN ulaşmasını, birincinin kilidi çoktan bırakmış
    // olacağı kadar geciktirebilir — bu durumda ikinci çağrı da MEŞRU
    // olarak kilidi alır (yarış yok, sadece geç kalmış). Testin gerçek
    // eşzamanlılığı ölçebilmesi için havuzu önceden ısıtıyoruz.
    await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);

    let runCount = 0;
    const slowJob = async () => {
      runCount += 1;
      await new Promise((r) => setTimeout(r, 500));
    };

    const [a, b] = await Promise.all([
      withJobLock('test_concurrent_job', slowJob),
      withJobLock('test_concurrent_job', slowJob),
    ]);

    const results = [a, b].sort();
    expect(results).toEqual(['ran', 'skipped']);
    expect(runCount).toBe(1);
  });

  it('kilit serbest bırakıldıktan sonra iş tekrar çalışabilir', async () => {
    const first = await withJobLock('test_sequential_job', async () => {});
    const second = await withJobLock('test_sequential_job', async () => {});

    expect(first).toBe('ran');
    expect(second).toBe('ran');
  });

  it('iş hata fırlatsa bile kilidi serbest bırakır', async () => {
    await expect(
      withJobLock('test_failing_job', async () => {
        throw new Error('kasıtlı hata');
      }),
    ).rejects.toThrow('kasıtlı hata');

    // Kilit serbest kaldıysa bu ikinci çağrı 'ran' döner
    const result = await withJobLock('test_failing_job', async () => {});
    expect(result).toBe('ran');
  });
});

describe('sendDayReminders', () => {
  it('tam 24 saat sonrasındaki randevuya hatırlatma gönderir', async () => {
    const customer = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Test', phone: '+905550001111' },
    });

    const appointment = await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: customer.id,
        serviceId: fx.serviceId,
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000),
        endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000 + 45 * 60_000),
        status: 'confirmed',
      },
    });

    const result = await sendDayReminders();
    expect(result).toBe('ran');

    const template = fake.messages.find((m) => m.templateName === 'hatirlatma_1gun');
    expect(template).toBeDefined();

    const updated = await testPrisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(updated?.reminder1DaySentAt).toBeInstanceOf(Date);
  });

  it('pencere dışındaki randevuya (örn. 2 gün sonrası) göndermez', async () => {
    const customer = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Test', phone: '+905550002222' },
    });

    await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: customer.id,
        serviceId: fx.serviceId,
        startsAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 48 * 60 * 60 * 1000 + 45 * 60_000),
        status: 'confirmed',
      },
    });

    await sendDayReminders();
    expect(fake.messages).toHaveLength(0);
  });

  it('zaten hatırlatılmış randevuya tekrar göndermez', async () => {
    const customer = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Test', phone: '+905550003333' },
    });

    await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: customer.id,
        serviceId: fx.serviceId,
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000),
        endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000 + 45 * 60_000),
        status: 'confirmed',
        reminder1DaySentAt: new Date(), // zaten gönderilmiş
      },
    });

    await sendDayReminders();
    expect(fake.messages).toHaveLength(0);
  });

  it('opt-out müşteriye göndermez ama bayrağı yine de işaretler', async () => {
    // Bayrak işaretlenmezse her tick'te aynı müşteri için sorgu döner —
    // gereksiz yere kontrol edilmeye devam eder.
    const customer = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Test', phone: '+905550004444', optedOut: true },
    });

    const appointment = await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: customer.id,
        serviceId: fx.serviceId,
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000),
        endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000 + 45 * 60_000),
        status: 'confirmed',
      },
    });

    await sendDayReminders();

    expect(fake.messages).toHaveLength(0);
    const updated = await testPrisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(updated?.reminder1DaySentAt).toBeInstanceOf(Date);
  });

  it('iptal edilmiş randevuya göndermez', async () => {
    const customer = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Test', phone: '+905550005555' },
    });

    await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: customer.id,
        serviceId: fx.serviceId,
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000),
        endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000 + 45 * 60_000),
        status: 'cancelled',
      },
    });

    await sendDayReminders();
    expect(fake.messages).toHaveLength(0);
  });
});

describe('sendHourReminders', () => {
  it('tam 1 saat sonrasındaki randevuya hatırlatma gönderir', async () => {
    const customer = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Test', phone: '+905550006666' },
    });

    await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: customer.id,
        serviceId: fx.serviceId,
        startsAt: new Date(Date.now() + 60 * 60 * 1000 + 60_000),
        endsAt: new Date(Date.now() + 60 * 60 * 1000 + 60_000 + 45 * 60_000),
        status: 'confirmed',
      },
    });

    await sendHourReminders();

    const template = fake.messages.find((m) => m.templateName === 'hatirlatma_1saat');
    expect(template).toBeDefined();
  });
});

describe('expirePendingAppointments', () => {
  it('süresi dolmuş onay bekleyen randevuyu iptal eder', async () => {
    const customer = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Test', phone: '+905550007777' },
    });

    const appointment = await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: customer.id,
        serviceId: fx.serviceId,
        startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 3 * 60 * 60 * 1000 + 45 * 60_000),
        status: 'pending_confirm',
        confirmDeadline: new Date(Date.now() - 60_000), // süresi dolmuş
      },
    });

    await expirePendingAppointments();

    const updated = await testPrisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(updated?.status).toBe('cancelled');
    expect(updated?.cancelledBy).toBe('system');
  });

  it('süresi dolmamış onay bekleyen randevuya dokunmaz', async () => {
    const customer = await testPrisma.customer.create({
      data: { shopId: fx.shopId, name: 'Test', phone: '+905550008888' },
    });

    const appointment = await testPrisma.appointment.create({
      data: {
        shopId: fx.shopId,
        barberId: fx.adminId,
        customerId: customer.id,
        serviceId: fx.serviceId,
        startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 3 * 60 * 60 * 1000 + 45 * 60_000),
        status: 'pending_confirm',
        confirmDeadline: new Date(Date.now() + 5 * 60_000),
      },
    });

    await expirePendingAppointments();

    const updated = await testPrisma.appointment.findUnique({ where: { id: appointment.id } });
    expect(updated?.status).toBe('pending_confirm');
  });
});

describe('cleanupExpired', () => {
  it('süresi dolmuş chat oturumunu siler', async () => {
    const session = await testPrisma.chatSession.create({
      data: {
        shopId: fx.shopId,
        phone: '+905550009999',
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    await cleanupExpired();

    const found = await testPrisma.chatSession.findUnique({ where: { id: session.id } });
    expect(found).toBeNull();
  });

  it('süresi dolmamış chat oturumuna dokunmaz', async () => {
    const session = await testPrisma.chatSession.create({
      data: {
        shopId: fx.shopId,
        phone: '+905550010000',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await cleanupExpired();

    const found = await testPrisma.chatSession.findUnique({ where: { id: session.id } });
    expect(found).not.toBeNull();

    await testPrisma.chatSession.delete({ where: { id: session.id } });
  });
});
