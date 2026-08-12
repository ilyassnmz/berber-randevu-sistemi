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
