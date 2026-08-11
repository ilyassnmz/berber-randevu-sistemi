import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

/**
 * Başlangıç verisi.
 *
 * Tekrar çalıştırılabilir (idempotent): mevcut kayıtları bozmaz, eksikleri ekler.
 * Bu sayede şema değiştikçe yeniden çalıştırmak güvenli.
 *
 * ⚠️ Şifreler kodda YAZILI DEĞİL. Her çalıştırmada rastgele üretilir ve bir kez
 * ekrana basılır. "admin123" gibi tahmin edilebilir bir şifre bırakmak, sistemin
 * ilk günden ele geçirilmesi demektir.
 */

const prisma = new PrismaClient();

const SHOP_SLUG = 'muslum-berber';

/** Okunabilir ama tahmin edilemez şifre üretir. */
function generatePassword(): string {
  // 18 bayt → 24 karakterlik base64url; ambiguity yaratan karakterler yok
  return randomBytes(18).toString('base64url');
}

/** todo.md → Proje Künyesi: hepsi şimdilik 45 dakika. */
const SERVICES = [
  { name: 'Saç', durationMin: 45, sortOrder: 1 },
  { name: 'Sakal', durationMin: 45, sortOrder: 2 },
  { name: 'Saç + Sakal', durationMin: 45, sortOrder: 3 },
  { name: 'Ağda', durationMin: 45, sortOrder: 4 },
  { name: 'Lazer', durationMin: 45, sortOrder: 5 },
  { name: 'Saç Boyama', durationMin: 45, sortOrder: 6 },
] as const;

/**
 * Haftalık çalışma düzeni. 0 = Pazar ... 6 = Cumartesi
 * Pazar kapalı varsayıldı — panelden değiştirilebilir.
 */
const WORKING_DAYS = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '20:15', isWorking: false }, // Pazar
  { dayOfWeek: 1, startTime: '09:00', endTime: '20:15', isWorking: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '20:15', isWorking: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '20:15', isWorking: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '20:15', isWorking: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '20:15', isWorking: true },
  { dayOfWeek: 6, startTime: '09:00', endTime: '20:15', isWorking: true }, // Cumartesi
] as const;

const BARBERS = [
  { name: 'Müslüm', email: 'muslum@muslumberber.com', role: 'admin' as const },
  { name: 'Fırat', email: 'firat@muslumberber.com', role: 'staff' as const },
];

async function main(): Promise<void> {
  console.log('Başlangıç verisi yükleniyor...\n');

  // ── Dükkan ────────────────────────────────────────────
  const shop = await prisma.shop.upsert({
    where: { slug: SHOP_SLUG },
    update: {},
    create: {
      name: 'Müslüm Berber',
      slug: SHOP_SLUG,
      timezone: 'Europe/Istanbul',
      slotStepMin: 45,
      maxAdvanceDays: 30,
      cancelCutoffMin: 120,
      confirmTimeoutMin: 5,
    },
  });
  console.log(`  Dükkan: ${shop.name}`);

  // ── Hizmetler ─────────────────────────────────────────
  for (const service of SERVICES) {
    await prisma.service.upsert({
      where: { shopId_name: { shopId: shop.id, name: service.name } },
      update: {},
      create: { ...service, shopId: shop.id },
    });
  }
  console.log(`  Hizmetler: ${SERVICES.length} adet (hepsi 45 dk)`);

  // ── Berberler ─────────────────────────────────────────
  const credentials: Array<{ name: string; email: string; password: string }> = [];

  for (const barberData of BARBERS) {
    const existing = await prisma.barber.findUnique({
      where: { shopId_email: { shopId: shop.id, email: barberData.email } },
    });

    if (existing) {
      console.log(`  Berber: ${barberData.name} (zaten var, şifre değiştirilmedi)`);
      continue;
    }

    const password = generatePassword();
    const passwordHash = await hash(password, {
      // argon2id varsayılanları — OWASP önerisiyle uyumlu
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const barber = await prisma.barber.create({
      data: {
        shopId: shop.id,
        name: barberData.name,
        email: barberData.email,
        role: barberData.role,
        passwordHash,
      },
    });

    credentials.push({ name: barberData.name, email: barberData.email, password });

    // Çalışma saatleri
    await prisma.workingHours.createMany({
      data: WORKING_DAYS.map((d) => ({ ...d, shopId: shop.id, barberId: barber.id })),
      skipDuplicates: true,
    });

    console.log(`  Berber: ${barber.name} (${barber.role}) + çalışma saatleri`);
  }

  // ── Giriş bilgileri ───────────────────────────────────
  if (credentials.length > 0) {
    console.log('\n' + '─'.repeat(62));
    console.log('  GİRİŞ BİLGİLERİ — bu ekran bir daha gösterilmeyecek');
    console.log('─'.repeat(62));
    for (const c of credentials) {
      console.log(`\n  ${c.name}`);
      console.log(`    E-posta : ${c.email}`);
      console.log(`    Şifre   : ${c.password}`);
    }
    console.log('\n' + '─'.repeat(62));
    console.log('  Bu şifreleri bir parola yöneticisine kaydedin.');
    console.log('  Şifreler veritabanında argon2id ile saklanır, geri alınamaz.');
    console.log('─'.repeat(62) + '\n');
  }

  console.log('Tamamlandı.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nBaşlangıç verisi yüklenemedi:');
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
