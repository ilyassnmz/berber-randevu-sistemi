import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';

/**
 * Entegrasyon testleri için izole veri kurar.
 *
 * Her test dosyası kendi dükkanını oluşturur ve sonunda siler; seed verisine
 * veya başka testlerin verisine dokunmaz. Böylece testler sırayla da,
 * paralel de çalışsa birbirini bozmaz.
 */

export const testPrisma = new PrismaClient();

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface TestFixture {
  shopId: string;
  adminId: string;
  staffId: string;
  customerId: string;
  /**
   * ⚠️ Fixture BİLEREK tek hizmetli.
   *
   * Birden fazla hizmete ihtiyaç duyan testler (çoklu hizmet) kendi
   * hizmetlerini kendi bloklarında oluşturuyor. Buraya eklendiğinde
   * "son aktif hizmet silinemez" gibi, dükkanda kaç hizmet olduğuna
   * dayanan testler sessizce anlamsızlaşıyor — denendi ve öyle oldu.
   */
  serviceId: string;
  adminEmail: string;
  staffEmail: string;
  password: string;
}

export async function createFixture(): Promise<TestFixture> {
  const suffix = randomUUID().slice(0, 8);
  const password = 'test-parola-1234';
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const shop = await testPrisma.shop.create({
    data: { name: `Test Dükkan ${suffix}`, slug: `test-${suffix}` },
  });

  const adminEmail = `admin-${suffix}@test.local`;
  const staffEmail = `staff-${suffix}@test.local`;

  const [admin, staff] = await Promise.all([
    testPrisma.barber.create({
      data: {
        shopId: shop.id,
        name: 'Test Yönetici',
        email: adminEmail,
        role: 'admin',
        passwordHash,
      },
    }),
    testPrisma.barber.create({
      data: {
        shopId: shop.id,
        name: 'Test Çalışan',
        email: staffEmail,
        role: 'staff',
        passwordHash,
      },
    }),
  ]);

  const [customer, service] = await Promise.all([
    testPrisma.customer.create({
      data: { shopId: shop.id, name: 'Test Müşteri', phone: `+9053${suffix}` },
    }),
    testPrisma.service.create({
      data: { shopId: shop.id, name: 'Test Hizmet', durationMin: 45, sortOrder: 1 },
    }),
  ]);

  return {
    shopId: shop.id,
    adminId: admin.id,
    staffId: staff.id,
    customerId: customer.id,
    serviceId: service.id,
    adminEmail,
    staffEmail,
    password,
  };
}

export async function destroyFixture(shopId: string): Promise<void> {
  if (!shopId) return;

  // Yabancı anahtar sırası: randevular ve jetonlar önce
  await testPrisma.appointment.deleteMany({ where: { shopId } });
  await testPrisma.refreshToken.deleteMany({
    where: { barber: { shopId } },
  });
  await testPrisma.shop.delete({ where: { id: shopId } }).catch(() => {
    // Cascade zaten temizlemiş olabilir
  });
}

/** Set-Cookie başlığından belirli bir çerezin değerini çıkarır. */
export function extractCookie(
  setCookieHeader: string | string[] | undefined,
  name: string,
): string | null {
  if (!setCookieHeader) return null;

  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];

  for (const cookie of cookies) {
    const match = new RegExp(`^${name}=([^;]+)`).exec(cookie);
    if (match?.[1]) return match[1];
  }
  return null;
}
