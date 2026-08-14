import { prisma } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * `Idempotency-Key` desteği (todo.md M3).
 *
 * Ağ hatası sonrası aynı isteği tekrar gönderen bir istemci (panelde
 * walk-in randevu oluştururken tipik senaryo: istek gönderildi, yanıt hiç
 * gelmedi ya da zaman aşımına uğradı, kullanıcı "gönder"e tekrar bastı)
 * işi tekrar yapmamalı — aynı anahtarla ilk seferin yanıtı aynen dönülür.
 *
 * Yarış durumu: iki istek gerçekten eşzamanlı gelirse ikisi de kaydı
 * bulamayıp işi yapabilir; ikinci `save` çağrısı benzersizlik kısıtına
 * takılıp sessizce yutulur (asıl iş zaten tamamlanmış, hata gizlenecek
 * bir şey değil). Bu, panelden tek bir kullanıcının tıkladığı bir buton
 * için kabul edilebilir bir sınır — gerçek eşzamanlılık burada beklenmiyor.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

export async function getIdempotentResponse(
  shopId: string,
  key: string,
): Promise<StoredResponse | null> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { shopId_key: { shopId, key } },
  });

  if (!existing || existing.expiresAt < new Date()) return null;

  return { statusCode: existing.statusCode, body: existing.response };
}

export async function saveIdempotentResponse(
  shopId: string,
  key: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  try {
    await prisma.idempotencyKey.create({
      data: {
        shopId,
        key,
        statusCode,
        response: body as never,
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
  } catch (error) {
    // Benzersizlik ihlali = eşzamanlı bir istek zaten kaydetmiş. Asıl işlem
    // (randevu oluşturma) başarıyla tamamlandı, bu sadece ikinci kaydın
    // gereksiz olması — hata fırlatıp asıl yanıtı bozmaya değmez.
    logger.debug({ err: error, shopId, key }, 'Idempotency kaydı yazılamadı (muhtemelen zaten var)');
  }
}
