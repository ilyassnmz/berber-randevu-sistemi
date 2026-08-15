import { APPOINTMENT_STATUS, type AppointmentStatus } from '@berber/shared';
import { prisma } from '../db/client.js';
import { NotFoundError } from '../lib/errors.js';
import { localDayBounds } from '../lib/time.js';
import { type AuthContext } from '../middleware/auth.js';

/**
 * Özet istatistikler.
 *
 * Yalnızca sayım/gruplama yapıyor — hesaplama veritabanında (`groupBy`),
 * uygulamada değil: binlerce randevuyu belleğe çekip JS'te saymak, tablo
 * büyüdükçe önce yavaşlar sonra belleği doldururdu.
 *
 * ⚠️ staff kendi verisini görür, admin dükkanın tamamını. Bu ayrım
 * `resolveBarberFilter` ile aynı gerekçeye dayanıyor: staff'ın istemciden
 * gönderdiği `barberId` parametresine güvenilmez.
 */

export interface StatsParams {
  shopId: string;
  /** Yerel tarih "2026-08-01" */
  from: string;
  /** Yerel tarih "2026-08-31" (bu gün DAHİL) */
  to: string;
  /** admin ise seçilen berber (yoksa tüm dükkan), staff ise her zaman kendisi */
  barberId?: string | undefined;
}

export async function getStats(params: StatsParams, auth: AuthContext) {
  const shop = await prisma.shop.findUnique({ where: { id: params.shopId } });
  if (!shop) throw new NotFoundError('Dükkan bulunamadı');

  // staff yalnızca kendi verisini görebilir — istemciden ne gelirse gelsin.
  const barberId = auth.role === 'admin' ? params.barberId : auth.barberId;

  const start = localDayBounds(params.from, shop.timezone).start;
  const end = localDayBounds(params.to, shop.timezone).end;

  const where = {
    shopId: params.shopId,
    startsAt: { gte: start, lt: end },
    ...(barberId ? { barberId } : {}),
  };

  const [byStatus, bySource, byBarber, uniqueCustomers] = await Promise.all([
    prisma.appointment.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ['source'], where, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ['barberId'], where, _count: { _all: true } }),
    prisma.appointment.findMany({ where, select: { customerId: true }, distinct: ['customerId'] }),
  ]);

  const statusCounts: Record<AppointmentStatus, number> = {
    [APPOINTMENT_STATUS.PENDING_CONFIRM]: 0,
    [APPOINTMENT_STATUS.CONFIRMED]: 0,
    [APPOINTMENT_STATUS.CANCELLED]: 0,
    [APPOINTMENT_STATUS.COMPLETED]: 0,
    [APPOINTMENT_STATUS.NO_SHOW]: 0,
  };
  for (const row of byStatus) {
    statusCounts[row.status as AppointmentStatus] = row._count._all;
  }

  const total = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);

  // Berber adlarını tek sorguda çözüyoruz (groupBy ilişki döndürmüyor).
  const barberIds = byBarber.map((b) => b.barberId);
  const barbers = await prisma.barber.findMany({
    where: { id: { in: barberIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(barbers.map((b) => [b.id, b.name]));

  return {
    range: { from: params.from, to: params.to },
    total,
    uniqueCustomers: uniqueCustomers.length,
    byStatus: statusCounts,
    bySource: {
      whatsapp: bySource.find((s) => s.source === 'whatsapp')?._count._all ?? 0,
      panel: bySource.find((s) => s.source === 'panel')?._count._all ?? 0,
    },
    byBarber: byBarber
      .map((b) => ({
        barberId: b.barberId,
        name: nameById.get(b.barberId) ?? 'Bilinmeyen',
        count: b._count._all,
      }))
      .sort((a, b) => b.count - a.count),
  };
}
