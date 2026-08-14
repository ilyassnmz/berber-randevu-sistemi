import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * Denetim kaydı.
 *
 * "Bu randevuyu kim iptal etti?", "müşteriyi kara listeye kim aldı?" gibi
 * sorular er ya da geç sorulur. Randevu tablosundaki `cancelled_by` bunu
 * kabaca söyler ama kim/ne zaman/hangi sebeple bilgisini tutmaz.
 */

export const AUDIT_ACTIONS = {
  APPOINTMENT_CREATE: 'appointment.create',
  APPOINTMENT_CONFIRM: 'appointment.confirm',
  APPOINTMENT_CANCEL: 'appointment.cancel',
  APPOINTMENT_COMPLETE: 'appointment.complete',
  APPOINTMENT_NO_SHOW: 'appointment.no_show',
  APPOINTMENT_RESCHEDULE: 'appointment.reschedule',
  CUSTOMER_BLACKLIST: 'customer.blacklist',
  CUSTOMER_UNBLACKLIST: 'customer.unblacklist',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  shopId: string;
  /** null = sistem (cron işleri) */
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Denetim kaydı yazar.
 *
 * ⚠️ Bu fonksiyon hata FIRLATMAZ. Denetim kaydı yazılamadı diye asıl işlem
 * (randevu iptali gibi) geri alınmamalı — kullanıcı açısından işlem başarılı
 * olmuştur. Hata yalnızca loglanır.
 *
 * Kaydın asıl işlemle aynı transaction'da olması gerekiyorsa
 * `buildAuditData` kullanılıp çağıran tarafta transaction'a eklenmelidir.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: buildAuditData(entry) });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, 'Denetim kaydı yazılamadı');
  }
}

export function buildAuditData(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  return {
    shopId: entry.shopId,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata ?? {},
  };
}
