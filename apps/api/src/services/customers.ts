import { prisma } from '../db/client.js';
import { NotFoundError } from '../lib/errors.js';
import { recordAudit, AUDIT_ACTIONS } from './audit.js';

export async function blacklistCustomer(
  shopId: string,
  customerId: string,
  reason: string,
  actorId: string,
) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId } });
  if (!customer) throw new NotFoundError('Müşteri bulunamadı');

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { isBlacklisted: true, blacklistNote: reason },
  });

  await recordAudit({
    shopId,
    actorId,
    action: AUDIT_ACTIONS.CUSTOMER_BLACKLIST,
    entityType: 'customer',
    entityId: customerId,
    metadata: { reason },
  });

  return updated;
}

export interface ListCustomersParams {
  shopId: string;
  search?: string | undefined;
  blacklistedOnly?: boolean | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Sayfalamalı, aranabilir müşteri listesi. */
export async function listCustomers(params: ListCustomersParams) {
  const where: Record<string, unknown> = { shopId: params.shopId };

  if (params.blacklistedOnly) where.isBlacklisted = true;

  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { phone: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  // Bir fazla çekip "devamı var mı" sorusunu cevaplıyoruz — listAppointments'la aynı desen.
  const rows = await prisma.customer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;

  return {
    items,
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

/** Müşteri detayı, randevu geçmişiyle. */
export async function getCustomer(shopId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shopId },
    include: {
      appointments: {
        orderBy: { startsAt: 'desc' },
        take: 50,
        include: {
          service: { select: { id: true, name: true } },
          barber: { select: { id: true, name: true } },
          // Geçmişte "saç + ağda" gelen müşteri, listede öyle görünmeli.
          services: {
            include: { service: { select: { id: true, name: true } } },
            orderBy: { service: { sortOrder: 'asc' } },
          },
        },
      },
    },
  });

  if (!customer) throw new NotFoundError('Müşteri bulunamadı');

  // Ara tablo istemciye sızmasın — `services` doğrudan hizmet listesi olsun.
  return {
    ...customer,
    appointments: customer.appointments.map(({ services, ...a }) => ({
      ...a,
      services: services.map((s) => s.service),
    })),
  };
}

export async function unblacklistCustomer(shopId: string, customerId: string, actorId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId } });
  if (!customer) throw new NotFoundError('Müşteri bulunamadı');

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { isBlacklisted: false, blacklistNote: null },
  });

  await recordAudit({
    shopId,
    actorId,
    action: AUDIT_ACTIONS.CUSTOMER_UNBLACKLIST,
    entityType: 'customer',
    entityId: customerId,
  });

  return updated;
}
