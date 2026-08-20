import { Router } from 'express';
import { upsertServiceSchema } from '@berber/shared';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';

export const servicesRouter: Router = Router();

servicesRouter.use(requireAuth);

/** Hizmet listesi — walk-in randevu formunda kullanılıyor. */
servicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      where: { shopId: req.auth!.shopId, isActive: true },
      select: { id: true, name: true, durationMin: true, price: true },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ services });
  }),
);

/**
 * Hizmeti günceller (ad, süre, fiyat) — yalnızca admin.
 *
 * ⚠️ `durationMin` değişikliği geçmişe dönük DEĞİL: mevcut randevuların
 * `ends_at` değeri kayıt anında hesaplanıp yazıldığı için oldukları gibi
 * kalır. Yalnızca bundan sonraki randevular yeni süreyi kullanır — aksi
 * halde süre değiştiren bir düzenleme geçmiş takvimi bozardı.
 */
servicesRouter.put(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = upsertServiceSchema.parse(req.body);

    const existing = await prisma.service.findFirst({
      where: { id: req.params.id!, shopId: req.auth!.shopId },
    });
    if (!existing) throw new NotFoundError('Hizmet bulunamadı');

    const service = await prisma.service.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        durationMin: input.durationMin,
        price: input.price ?? null,
        isActive: input.isActive,
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      },
      select: { id: true, name: true, durationMin: true, price: true, isActive: true },
    });

    res.json({ service });
  }),
);

/**
 * Yeni hizmet ekler — yalnızca admin.
 *
 * Eklenen hizmet müşteri sitesinde ANINDA görünür: site hizmet listesini
 * her açılışta sunucudan çekiyor ve API yanıtları önbelleklenmiyor.
 *
 * `sortOrder` verilmezse listenin SONUNA eklenir. Berber yeni bir hizmeti
 * eklerken sıralama düşünmek zorunda kalmasın diye; mevcut hizmetlerin
 * sırası da bozulmasın diye.
 */
servicesRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = upsertServiceSchema.parse(req.body);
    const shopId = req.auth!.shopId;

    // Aynı isimde hizmet varsa engelle: müşteri listede iki "Kaş Alma"
    // görürse hangisini seçeceğini bilemez.
    const ayniIsim = await prisma.service.findFirst({
      where: { shopId, name: { equals: input.name, mode: 'insensitive' } },
    });

    if (ayniIsim) {
      throw new ConflictError('Bu isimde bir hizmet zaten var.', 'SERVICE_NAME_TAKEN');
    }

    const sonSira = await prisma.service.aggregate({
      where: { shopId },
      _max: { sortOrder: true },
    });

    const service = await prisma.service.create({
      data: {
        shopId,
        name: input.name,
        durationMin: input.durationMin,
        price: input.price ?? null,
        isActive: input.isActive,
        sortOrder: input.sortOrder ?? (sonSira._max.sortOrder ?? 0) + 1,
      },
      select: { id: true, name: true, durationMin: true, price: true, isActive: true },
    });

    res.status(201).json({ service });
  }),
);
