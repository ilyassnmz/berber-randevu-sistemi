import { Router } from 'express';
import { upsertServiceSchema } from '@berber/shared';
import { prisma } from '../db/client.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { publicShopInfoOnbelleginiDusur } from '../services/public-booking.js';

export const servicesRouter: Router = Router();

servicesRouter.use(requireAuth);

/** Hizmet listesi — walk-in randevu formunda kullanılıyor. */
servicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const services = await prisma.service.findMany({
      where: { shopId: req.auth!.shopId, isActive: true },
      select: { id: true, name: true, durationMin: true, price: true, requiresOwnSlot: true },
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

    // ⚠️ Ad değiştirilebiliyor, dolayısıyla ÇAKIŞMA kontrolü burada da gerekli.
    //
    // Ekleme ucunda bu kontrol baştan beri vardı ama güncellemede yoktu:
    // ad alanı panelde salt okunur olduğu için çakışma imkânsızdı. Ad
    // düzenlenebilir hale gelince eksiklik gerçek bir soruna dönüştü —
    // veritabanındaki `@@unique([shopId, name])` kısıtı isteği 500 ile
    // düşürürdü. Kısıt yine son savunma; buradaki kontrol kullanıcıya
    // anlaşılır bir mesaj vermek için.
    if (input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const ayniIsim = await prisma.service.findFirst({
        where: {
          shopId: req.auth!.shopId,
          name: { equals: input.name, mode: 'insensitive' },
          id: { not: existing.id },
        },
      });

      if (ayniIsim) {
        throw new ConflictError('Bu isimde bir hizmet zaten var.', 'SERVICE_NAME_TAKEN');
      }
    }

    const service = await prisma.service.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        durationMin: input.durationMin,
        requiresOwnSlot: input.requiresOwnSlot,
        price: input.price ?? null,
        isActive: input.isActive,
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      },
      select: { id: true, name: true, durationMin: true, price: true, requiresOwnSlot: true, isActive: true },
    });

    // Site açılışındaki `/shop` yanıtı önbellekli; değişikliğin anında
    // görünmesi için önbellek düşürülüyor (bkz. services/public-booking.ts).
    publicShopInfoOnbelleginiDusur();
    res.json({ service });
  }),
);

/**
 * Yeni hizmet ekler — yalnızca admin.
 *
 * Eklenen hizmet müşteri sitesinde ANINDA görünür: `/shop` yanıtı bellekte
 * önbellekleniyor ama bu uç önbelleği düşürüyor, dolayısıyla siteye giren
 * ilk ziyaretçi yeni listeyi görüyor.
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
        requiresOwnSlot: input.requiresOwnSlot,
        price: input.price ?? null,
        isActive: input.isActive,
        sortOrder: input.sortOrder ?? (sonSira._max.sortOrder ?? 0) + 1,
      },
      select: { id: true, name: true, durationMin: true, price: true, requiresOwnSlot: true, isActive: true },
    });

    // Site açılışındaki `/shop` yanıtı önbellekli; değişikliğin anında
    // görünmesi için önbellek düşürülüyor (bkz. services/public-booking.ts).
    publicShopInfoOnbelleginiDusur();
    res.status(201).json({ service });
  }),
);

/**
 * Hizmeti kaldırır — yalnızca admin.
 *
 * ── İki farklı silme ─────────────────────────────────────────────
 *
 * Hizmet HİÇ kullanılmamışsa gerçekten silinir. Yanlışlıkla eklenen ya da
 * adı hatalı yazılan bir hizmet ortalıkta iz bırakmasın.
 *
 * Randevusu VARSA silinmez, gizlenir (isActive = false). İki sebeple:
 *   1. Veritabanı kısıtı zaten engelliyor (onDelete: Restrict) — randevu
 *      hangi hizmete ait olduğunu kaybedemez.
 *   2. Geçmiş randevularda "Saç Boyama" yazması gerekiyor; hizmet silinse
 *      berber geçmişte ne yaptığını göremezdi.
 *
 * Gizlenen hizmet müşteri sitesinde ve panelde görünmez ama eski
 * randevularda adı okunmaya devam eder.
 */
servicesRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const shopId = req.auth!.shopId;

    const service = await prisma.service.findFirst({
      where: { id: req.params.id!, shopId },
    });
    if (!service) throw new NotFoundError('Hizmet bulunamadı');

    // ⚠️ Son aktif hizmet silinemez.
    //
    // Hizmetsiz bir dükkanda müşteri randevu alamaz ve panel saat ızgarasını
    // hesaplayamaz (süreyi hizmetten okuyor). Sistemi kullanılamaz hale
    // getiren bir işlemi sessizce yapmaktansa açıkça reddetmek doğrusu.
    const aktifSayisi = await prisma.service.count({ where: { shopId, isActive: true } });
    if (service.isActive && aktifSayisi <= 1) {
      throw new ConflictError(
        'Son hizmeti kaldıramazsınız — randevu alınabilmesi için en az bir hizmet gerekli.',
        'LAST_SERVICE',
      );
    }

    // ⚠️ `appointments.service_id` üzerinden saymak YETMEZ.
    //
    // Bir hizmet, randevunun ANA hizmeti olmadan da kullanılmış olabilir:
    // "Saç + Ağda" randevusunda ana hizmet Saç, ama Ağda da o randevunun
    // parçası. Yalnızca ana hizmete bakılsaydı Ağda "hiç kullanılmamış"
    // sayılır, gerçekten silinmeye çalışılır ve veritabanı kısıtı 500 ile
    // patlardı. Hizmet–randevu ilişkisinin tamamı burada.
    const randevuSayisi = await prisma.appointmentService.count({
      where: { serviceId: service.id },
    });

    if (randevuSayisi === 0) {
      try {
        await prisma.service.delete({ where: { id: service.id } });

        // Site açılışındaki `/shop` yanıtı önbellekli; değişikliğin anında
        // görünmesi için önbellek düşürülüyor (bkz. services/public-booking.ts).
        publicShopInfoOnbelleginiDusur();
        res.json({ mode: 'deleted', appointmentCount: 0 });
        return;
      } catch {
        // ⚠️ Sayım ile silme ARASINDA randevu alınmış olabilir.
        //
        // Veritabanı bu durumda silmeyi reddediyor (onDelete: Restrict) —
        // doğrulandı, koruma çalışıyor. Ama hata yakalanmazsa müşteriye 500
        // dönerdi. Oysa doğru davranış belli: randevusu olan hizmet gizlenir.
        //
        // Bu yarışın gerçekleşmesi için berberin hizmeti sildiği AN müşterinin
        // aynı hizmete randevu alması gerekiyor; nadir ama imkânsız değil ve
        // sonucu sessizce yanlış olmamalı.
        logger.warn(
          { serviceId: service.id },
          'Hizmet silinirken araya randevu girdi — gizlemeye düşülüyor',
        );
      }
    }

    await prisma.service.update({
      where: { id: service.id },
      data: { isActive: false },
    });

    // Site açılışındaki `/shop` yanıtı önbellekli; değişikliğin anında
    // görünmesi için önbellek düşürülüyor (bkz. services/public-booking.ts).
    publicShopInfoOnbelleginiDusur();
    res.json({ mode: 'hidden', appointmentCount: randevuSayisi });
  }),
);
