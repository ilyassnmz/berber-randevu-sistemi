import { hash as hashPassword } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';

/**
 * Bir berberin şifresini sıfırlar ve yeni şifreyi bir kez ekrana basar.
 *
 *     npm run reset-password --workspace=@berber/api -- muslum@ozdede.com
 *
 * seed.ts'teki aynı üretim/hash mantığını kullanır. Şifre değişince diğer
 * cihazlardaki oturumlar (changePassword ile aynı gerekçeyle) kapatılır.
 */

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Kullanım: npm run reset-password --workspace=@berber/api -- <e-posta>');
    process.exit(1);
  }

  const barber = await prisma.barber.findFirst({ where: { email } });
  if (!barber) {
    console.error(`Bulunamadı: ${email}`);
    process.exit(1);
  }

  const password = generatePassword();
  const passwordHash = await hashPassword(password, ARGON2_OPTIONS);

  await prisma.$transaction([
    prisma.barber.update({ where: { id: barber.id }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { barberId: barber.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  console.log('\n' + '─'.repeat(62));
  console.log(`  ${barber.name} — yeni şifre (bu ekran bir daha gösterilmeyecek)`);
  console.log('─'.repeat(62));
  console.log(`  E-posta : ${barber.email}`);
  console.log(`  Şifre   : ${password}`);
  console.log('─'.repeat(62) + '\n');
}

main()
  .catch((error: unknown) => {
    console.error('Şifre sıfırlanamadı:');
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
