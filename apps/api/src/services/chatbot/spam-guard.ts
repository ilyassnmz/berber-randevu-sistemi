import { prisma } from '../../db/client.js';

/**
 * Spam koruması (todo.md M4 + M6):
 *
 *   - M4 "Webhook rate limit telefon numarasına göre" ve
 *   - M6 "Spam: 1 dakikada 10+ mesaj → 5 dakika sessizlik"
 *
 * aynı tehdide (tek numaranın webhook'u/chatbot'u sel gibi mesajla boğması)
 * karşı aynı koruma — burada tek bir mekanizmayla ikisi de karşılanıyor.
 *
 * Sayaç DB'de (customers tablosu) tutulur, bellekte DEĞİL: chat_sessions'ın
 * aynı gerekçesiyle (bkz. chatbot/states.ts) — sunucu yeniden başlasa da ya
 * da birden fazla örnek çalışsa da sayaç ortak ve tutarlı kalsın diye.
 */

const BURST_WINDOW_MS = 60_000;
/**
 * todo.md "10+" diyor, ama tek bir meşru randevu akışı (buton tıklamalarıyla)
 * ~7-8 mesaj sürüyor — hızlı bir müşteri art arda iki akış denese (randevu al
 * + hemen ardından bir tane daha) 10'u kolayca aşar ve haksız yere susturulur.
 * 20, gerçek bir kullanıcının birkaç akışını rahatça karşılarken otomatik/betik
 * kaynaklı gerçek bir sel'i hâlâ hızla (saniyeler içinde) yakalıyor.
 */
const BURST_LIMIT = 20;
const SILENCE_MS = 5 * 60_000;

/**
 * Bu mesaj işlenmeden ÖNCE çağrılır. `true` dönerse mesaj sessizce
 * (yanıtsız) atlanmalı — çağıran taraf hiçbir DB yazması/WhatsApp isteği
 * yapmadan dönmeli.
 */
export async function shouldSilence(customerId: string): Promise<boolean> {
  const now = new Date();

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { messageBurstCount: true, messageBurstWindowStart: true, silencedUntil: true },
  });
  if (!customer) return false;

  if (customer.silencedUntil && customer.silencedUntil > now) {
    return true;
  }

  const windowStart = customer.messageBurstWindowStart;
  const windowExpired = !windowStart || now.getTime() - windowStart.getTime() > BURST_WINDOW_MS;
  const newCount = windowExpired ? 1 : customer.messageBurstCount + 1;
  const crossesLimit = newCount > BURST_LIMIT;

  await prisma.customer.update({
    where: { id: customerId },
    data: crossesLimit
      ? {
          messageBurstCount: 0,
          messageBurstWindowStart: null,
          silencedUntil: new Date(now.getTime() + SILENCE_MS),
        }
      : {
          messageBurstCount: newCount,
          messageBurstWindowStart: windowExpired ? now : windowStart,
          silencedUntil: null,
        },
  });

  return crossesLimit;
}
