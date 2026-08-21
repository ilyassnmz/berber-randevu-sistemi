import webpush from 'web-push';
import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  TARAYICI BİLDİRİMLERİ (Web Push)
 * ══════════════════════════════════════════════════════════════════
 *
 * Müşteri siteden randevu aldığında berberin telefonuna bildirim düşer.
 *
 * ── Neden Web Push? ───────────────────────────────────────────────
 *
 * WhatsApp Cloud API kapsam dışı (berberin numarası uygulamada kalsın diye),
 * SMS ücretli. Panel zaten bir PWA ve telefona kurulu; Web Push bu yüzden
 * ücretsiz ve ek hesap gerektirmeyen tek yol.
 *
 * ── Yapılandırılmamışsa ne olur? ──────────────────────────────────
 *
 * VAPID anahtarları yoksa modül sessizce devre dışı kalır. Bilinçli:
 * bildirim gönderilememesi randevu alınmasını ENGELLEMEMELİ.
 */

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT ?? 'mailto:info@ozdedehairstudio.com';

export const isPushConfigured = Boolean(publicKey && privateKey);

if (isPushConfigured) {
  webpush.setVapidDetails(subject, publicKey!, privateKey!);
}

/** Panel, aboneliği kurarken bu anahtara ihtiyaç duyuyor. */
export function getPublicKey(): string | null {
  return publicKey ?? null;
}

interface Bildirim {
  title: string;
  body: string;
  /** Tıklanınca açılacak panel yolu. */
  url?: string;
}

/**
 * Bir berberin TÜM cihazlarına bildirim gönderir.
 *
 * Berberin telefonu + tableti + tarayıcısı ayrı abonelik demek; hepsine
 * gönderiliyor ki hangisi elindeyse orada görsün.
 *
 * ⚠️ Hiçbir hata dışarı sızmıyor. Bu fonksiyon randevu oluşturma akışının
 * içinden çağrılıyor ve bildirim gönderilememesi randevuyu düşürmemeli —
 * müşteri açısından randevu başarıyla alınmıştır.
 */
async function berberBildirimGonder(barberId: string, bildirim: Bildirim): Promise<number> {
  const abonelikler = await prisma.pushSubscription.findMany({ where: { barberId } });
  if (abonelikler.length === 0) return 0;

  const govde = JSON.stringify(bildirim);
  let gonderilen = 0;

  for (const abone of abonelikler) {
    try {
      await webpush.sendNotification(
        {
          endpoint: abone.endpoint,
          keys: { p256dh: abone.p256dh, auth: abone.auth },
        },
        govde,
      );
      gonderilen += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;

      // 404/410 = abonelik artık geçersiz (uygulama silinmiş, izin geri
      // alınmış, tarayıcı verisi temizlenmiş). Bunlar temizlenmezse her
      // randevuda tekrar denenip boşuna hata üretirler.
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: abone.id } }).catch(() => {});
        logger.info({ barberId }, 'Geçersiz bildirim aboneliği silindi');
        continue;
      }

      logger.error({ err: error, barberId, statusCode }, 'Bildirim gönderilemedi');
    }
  }

  return gonderilen;
}

/**
 * Yeni randevu bildirimi.
 *
 * ── Kime gidiyor? ─────────────────────────────────────────────────
 *
 * Randevunun berberine VE tüm adminlere. Müslüm patron olduğu için Fırat'a
 * alınan randevuyu da görmek istiyor.
 *
 * Randevu zaten admine aitse tek bildirim gider — `Set` bunu garantiliyor;
 * aksi halde Müslüm kendi randevusu için iki bildirim alırdı.
 */
export async function yeniRandevuBildirimi(params: {
  shopId: string;
  barberId: string;
  barberName: string;
  customerName: string | null;
  serviceName: string;
  /** Dükkan saatinde gösterim: "22 Ağustos Cumartesi, 14:15" */
  zaman: string;
}): Promise<void> {
  if (!isPushConfigured) return;

  try {
    const adminler = await prisma.barber.findMany({
      where: { shopId: params.shopId, role: 'admin', isActive: true },
      select: { id: true },
    });

    const alicilar = new Set<string>([params.barberId, ...adminler.map((a) => a.id)]);

    const musteri = params.customerName ?? 'İsimsiz müşteri';

    for (const alici of alicilar) {
      // Kendi randevusu mu, başkasının mı? Metin buna göre değişiyor:
      // Müslüm "Fırat'a randevu" bildirimini kendi randevusundan ayırabilmeli.
      const kendisi = alici === params.barberId;

      await berberBildirimGonder(alici, {
        title: kendisi ? 'Yeni randevunuz var' : `${params.barberName} için yeni randevu`,
        body: `${musteri} · ${params.serviceName}\n${params.zaman}`,
        url: '/',
      });
    }
  } catch (error) {
    // Bildirim akışındaki HİÇBİR hata randevuyu etkilememeli.
    logger.error({ err: error }, 'Randevu bildirimi gönderilirken hata');
  }
}
