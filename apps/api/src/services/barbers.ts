import { hash as hashPassword } from '@node-rs/argon2';
import type { WorkingHoursInput } from '@berber/shared';
import { prisma } from '../db/client.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../lib/errors.js';
import { assertCanAccessBarber, type AuthContext } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import { recordAudit, AUDIT_ACTIONS } from './audit.js';

/**
 * Berber yönetimi: çalışma saatleri, izin günleri, yeni berber ekleme.
 *
 * `working_hours` ve `time_off` tabloları şemada baştan beri vardı, slot
 * motoru bunları OKUYORDU — ama hiçbir yerden YAZILMIYORDU (seed.ts
 * dışında). Panelde bunu düzenleyecek bir ekran da yoktu.
 */

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// ─── Çalışma saatleri ───────────────────────────────────

export async function getWorkingHours(shopId: string, barberId: string, auth: AuthContext) {
  assertCanAccessBarber(auth, barberId);

  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } });
  if (!barber) throw new NotFoundError('Berber bulunamadı');

  return prisma.workingHours.findMany({
    where: { barberId },
    orderBy: { dayOfWeek: 'asc' },
  });
}

/**
 * 7 günü BİRDEN değiştirir — kısmi güncelleme yok, kısıt (`workingHoursSchema`)
 * zaten 7 gün eksiksiz göndermeyi zorunlu kılıyor. Böylece bir gün unutulup
 * eski değerle yarım kalmış bir haftalık program oluşmaz.
 */
export async function updateWorkingHours(
  shopId: string,
  barberId: string,
  days: WorkingHoursInput,
  auth: AuthContext,
) {
  assertCanAccessBarber(auth, barberId);

  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } });
  if (!barber) throw new NotFoundError('Berber bulunamadı');

  await prisma.$transaction(
    days.map((day) =>
      prisma.workingHours.upsert({
        where: { barberId_dayOfWeek: { barberId, dayOfWeek: day.dayOfWeek } },
        create: { shopId, barberId, ...day },
        update: { startTime: day.startTime, endTime: day.endTime, isWorking: day.isWorking },
      }),
    ),
  );

  return prisma.workingHours.findMany({ where: { barberId }, orderBy: { dayOfWeek: 'asc' } });
}

// ─── İzin günleri ───────────────────────────────────────

export async function listTimeOff(shopId: string, barberId: string, auth: AuthContext) {
  assertCanAccessBarber(auth, barberId);

  return prisma.timeOff.findMany({
    where: { shopId, barberId, endsAt: { gt: new Date() } },
    orderBy: { startsAt: 'asc' },
  });
}

export async function createTimeOff(
  shopId: string,
  barberId: string,
  startsAt: Date,
  endsAt: Date,
  reason: string,
  auth: AuthContext,
) {
  assertCanAccessBarber(auth, barberId);

  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } });
  if (!barber) throw new NotFoundError('Berber bulunamadı');

  return prisma.timeOff.create({
    data: { shopId, barberId, startsAt, endsAt, reason, createdById: auth.barberId },
  });
}

export async function deleteTimeOff(shopId: string, timeOffId: string, auth: AuthContext) {
  const timeOff = await prisma.timeOff.findFirst({ where: { id: timeOffId, shopId } });
  if (!timeOff) throw new NotFoundError('İzin kaydı bulunamadı');

  // Dükkan geneli (barberId=null) izinler yalnızca admin tarafından silinebilir.
  if (timeOff.barberId) {
    assertCanAccessBarber(auth, timeOff.barberId);
  } else if (auth.role !== 'admin') {
    throw new ForbiddenError('Yalnızca yönetici dükkan geneli izinleri silebilir');
  }

  await prisma.timeOff.delete({ where: { id: timeOffId } });
}

// ─── Yeni berber ekleme ─────────────────────────────────

export interface CreateBarberResult {
  barber: { id: string; name: string; email: string; role: string };
}

/**
 * Yeni berber ekler. Yalnızca admin çağırabilir (route katmanında `requireAdmin`
 * ile zaten kısıtlı, burada TEKRAR kontrol edilmiyor çünkü hedef bir "barberId"
 * değil — assertCanAccessBarber'ın koruduğu şey bu değil, ayrı bir yetki sınıfı).
 *
 * ⚠️ Şifreyi YÖNETİCİ veriyor; burada rastgele şifre ÜRETİLMİYOR.
 *
 * Eskiden üretiliyor ve panelde bir kez gösteriliyordu. Güvenlik açısından
 * doğruydu ama kullanımda çöktü: yönetici o ekranı kapatınca şifre kayboluyor
 * ve geri getirmenin hiçbir yolu kalmıyordu (argon2id geri döndürülemez,
 * panelde de sıfırlama yoktu). Canlıda tam olarak bu yaşandı — eklenen berber
 * panele hiç giremedi.
 *
 * Şifreyi yöneticinin belirlemesi sırrı ortadan kaldırıyor: kaybolacak bir şey
 * yok, çünkü şifreyi zaten o seçti ve berbere kendisi söylüyor. Ham şifre yine
 * hiçbir yerde saklanmıyor, yalnızca argon2id özeti yazılıyor.
 */
export async function createBarber(
  shopId: string,
  name: string,
  email: string,
  password: string,
  role: 'admin' | 'staff',
): Promise<CreateBarberResult> {
  const existing = await prisma.barber.findUnique({
    where: { shopId_email: { shopId, email } },
  });
  if (existing) throw new ValidationError('Bu e-posta ile kayıtlı bir berber zaten var');

  const passwordHash = await hashPassword(password, ARGON2_OPTIONS);

  const barber = await prisma.barber.create({
    data: { shopId, name, email, role, passwordHash },
  });

  // Varsayılan çalışma programı: Pazar kapalı, diğer günler 09:00-20:15 —
  // seed.ts'teki dükkan varsayılanıyla aynı. Boş bir haftayla başlamasın.
  await prisma.workingHours.createMany({
    data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      shopId,
      barberId: barber.id,
      dayOfWeek,
      startTime: '09:00',
      endTime: '20:15',
      isWorking: dayOfWeek !== 0,
    })),
  });

  return {
    barber: { id: barber.id, name: barber.name, email: barber.email, role: barber.role },
  };
}

// ─── Berber düzenleme / pasife alma ─────────────────────

/**
 * Berberin adını, rolünü ve aktifliğini günceller — yalnızca admin.
 *
 * ── Neden silme yok, pasife alma var? ────────────────────────────
 *
 * `appointments.barber_id` üzerinde `onDelete: Restrict` var: randevusu olan
 * bir berber veritabanı seviyesinde zaten silinemez. Silinebilseydi de
 * istemezdik — geçmiş randevunun kime ait olduğu okunabilir kalmalı.
 *
 * ── Üç koruma ────────────────────────────────────────────────────
 *
 * Üçü de "çalışan sistemi bozmama" amacında ve üçü de gerçek bir senaryodan
 * geliyor:
 *
 *   1. SON AKTİF ADMİN pasife alınamaz / staff'a düşürülemez. Aksi halde
 *      dükkanda hiç yönetici kalmaz: yeni berber eklemek, hizmet düzenlemek
 *      ve bu ekranı açmak mümkün olmaz. Geri dönüşü ancak veritabanından
 *      elle müdahaleyle olurdu.
 *
 *   2. KENDİNİ pasife alamazsın. Teknik olarak 1. kural çoğu durumda bunu
 *      zaten engelliyor, ama iki admin varken kendini kapatıp panelden
 *      düşmek hâlâ mümkün olurdu — ve bu, kullanıcının istediği şey değil,
 *      yanlışlıkla yaptığı şeydir.
 *
 *   3. GELECEK RANDEVUSU OLAN berber pasife alınamaz. Sebebi görünmez ve
 *      ciddi: panel berber sekmelerini `GET /barbers` üzerinden kuruyor ve o
 *      uç yalnızca aktifleri döndürüyor. Pasife alınan berberin sekmesi
 *      kaybolur, dolayısıyla gelecek randevuları PANELDE GÖRÜNMEZ hale
 *      gelir — müşteri kapıya gelir, sistemde iz yoktur. Bu yüzden önce
 *      randevuların taşınması ya da iptal edilmesi gerekiyor; kaç tane
 *      olduğunu da hata mesajında söylüyoruz.
 */
export async function updateBarber(
  shopId: string,
  barberId: string,
  input: { name: string; role: 'admin' | 'staff'; isActive: boolean },
  auth: AuthContext,
) {
  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } });
  if (!barber) throw new NotFoundError('Berber bulunamadı');

  const yetkisiKalkiyor = barber.role === 'admin' && (input.role !== 'admin' || !input.isActive);

  if (yetkisiKalkiyor) {
    const digerAktifAdmin = await prisma.barber.count({
      where: { shopId, role: 'admin', isActive: true, id: { not: barberId } },
    });

    if (digerAktifAdmin === 0) {
      throw new ValidationError(
        'Dükkandaki son yöneticiyi kapatamaz ya da yetkisini alamazsınız. ' +
          'Önce başka bir berbere yönetici yetkisi verin.',
      );
    }
  }

  if (!input.isActive && barberId === auth.barberId) {
    throw new ValidationError('Kendi hesabınızı kapatamazsınız.');
  }

  if (barber.isActive && !input.isActive) {
    const gelecekRandevu = await prisma.appointment.count({
      where: {
        barberId,
        startsAt: { gte: new Date() },
        status: { in: ['pending_confirm', 'confirmed'] },
      },
    });

    if (gelecekRandevu > 0) {
      throw new ValidationError(
        `${barber.name} için ${gelecekRandevu} adet gelecek randevu var. ` +
          'Berberi kapatmadan önce bu randevuları iptal edin ya da başka bir ' +
          'berbere taşıyın — aksi halde panelde görünmez hale gelirler.',
      );
    }
  }

  const guncel = await prisma.barber.update({
    where: { id: barberId },
    data: { name: input.name, role: input.role, isActive: input.isActive },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  return guncel;
}

/**
 * Dükkandaki berberler — pasifler dahil.
 *
 * `GET /barbers` bilerek yalnızca aktifleri dönüyor (takvim sekmeleri, walk-in
 * formu). Ama yönetim ekranı pasifleri de görmek zorunda; aksi halde kapatılan
 * bir berber geri açılamaz, listeden tamamen kaybolur.
 */
export async function listAllBarbers(shopId: string) {
  /**
   * Randevu sayıları da dönüyor — silme onayı için ZORUNLU.
   *
   * Berber silmek randevularını da siliyor (bkz. deleteBarber). Yönetici bu
   * kararı, kaç randevunun gideceğini görmeden veremez; "5 randevu da
   * silinecek, 2'si gelecek tarihli" bilgisi onay ekranında yazıyor.
   *
   * Sayımlar tek sorguda toplanıyor, berber başına ayrı sorgu atılmıyor.
   */
  const [barbers, gelecekSayimlari] = await Promise.all([
    prisma.barber.findMany({
      where: { shopId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        _count: { select: { appointments: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.appointment.groupBy({
      by: ['barberId'],
      where: {
        shopId,
        startsAt: { gte: new Date() },
        status: { in: ['pending_confirm', 'confirmed'] },
      },
      _count: { _all: true },
    }),
  ]);

  const gelecekById = new Map(gelecekSayimlari.map((g) => [g.barberId, g._count._all]));

  return barbers.map(({ _count, ...b }) => ({
    ...b,
    appointmentCount: _count.appointments,
    futureAppointmentCount: gelecekById.get(b.id) ?? 0,
  }));
}

/**
 * Berberi ve TÜM randevularını kalıcı olarak siler — yalnızca admin.
 *
 * ⚠️ Sistemdeki tek gerçekten YIKICI işlem. Geri alınamaz.
 *
 * ── Neden randevular da siliniyor? ───────────────────────────────
 *
 * `appointments.barber_id` üzerinde `onDelete: Restrict` var: veritabanı,
 * randevusu olan bir berberi silmeyi reddediyor. Dolayısıyla "berberi
 * tamamen sil" istemek, kaçınılmaz olarak "randevularını da sil" demek —
 * üçüncü bir seçenek yok (randevuyu başka berbere devretmek geçmişi
 * çarpıtırdı, `barber_id`'yi boş bırakmak ise şema gereği mümkün değil).
 *
 * İlk sürüm bu yüzden randevusu olan berberi silmeyip kapatıyordu. Kullanıcı
 * bunun aksini istedi: deneme ve ayrılan berber kayıtları listede kalmasın.
 * Karar bilinçli olarak kullanıcıya bırakıldı; buradaki sorumluluk, kararı
 * BİLGİLİ hale getirmek:
 *
 *   * `listAllBarbers` her berberin randevu sayısını (ve kaçının gelecekte
 *     olduğunu) döndürüyor, panel onay ekranında bunu gösteriyor.
 *   * Silme, olan biteni denetim kaydına yazıyor — sonradan "bu randevular
 *     nereye gitti?" sorusunun cevaplanabildiği tek yer orası.
 *
 * ── Korunan iki kural ────────────────────────────────────────────
 *
 * Bu ikisi veri değil, SİSTEME ERİŞİM koruması; kaldırılırsa dükkan
 * yönetilemez hale gelir:
 *   1. Kendi hesabını silemezsin.
 *   2. Son aktif yöneticiyi silemezsin.
 */
export async function deleteBarber(
  shopId: string,
  barberId: string,
  auth: AuthContext,
): Promise<{ appointmentCount: number }> {
  const barber = await prisma.barber.findFirst({ where: { id: barberId, shopId } });
  if (!barber) throw new NotFoundError('Berber bulunamadı');

  if (barberId === auth.barberId) {
    throw new ValidationError('Kendi hesabınızı silemezsiniz.');
  }

  if (barber.role === 'admin' && barber.isActive) {
    const digerAktifAdmin = await prisma.barber.count({
      where: { shopId, role: 'admin', isActive: true, id: { not: barberId } },
    });
    if (digerAktifAdmin === 0) {
      throw new ValidationError(
        'Dükkandaki son yöneticiyi silemezsiniz. ' +
          'Önce başka bir berbere yönetici yetkisi verin.',
      );
    }
  }

  const randevuSayisi = await prisma.appointment.count({ where: { barberId } });

  // ⚠️ Tek işlem (transaction): randevular silinip berber silinemezse ortada
  // randevusuz bir berber, tersi olursa yetim randevular kalırdı.
  await prisma.$transaction([
    prisma.appointment.deleteMany({ where: { barberId } }),
    prisma.barber.delete({ where: { id: barberId } }),
  ]);

  await recordAudit({
    shopId,
    actorId: auth.barberId,
    action: AUDIT_ACTIONS.BARBER_DELETE,
    entityType: 'barber',
    entityId: barberId,
    metadata: { name: barber.name, email: barber.email, appointmentCount: randevuSayisi },
  });

  logger.warn(
    { barberId, name: barber.name, randevuSayisi },
    'Berber ve tüm randevuları kalıcı olarak silindi',
  );

  return { appointmentCount: randevuSayisi };
}
