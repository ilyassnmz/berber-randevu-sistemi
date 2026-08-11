import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * ══════════════════════════════════════════════════════════════════
 *  WEBHOOK İMZA DOĞRULAMASI
 * ══════════════════════════════════════════════════════════════════
 *
 * Meta'nın webhook'u herkese açık bir URL. Bu doğrulama olmadan, adresi
 * bulan herhangi biri sahte "müşteri mesajı" gönderip randevu oluşturabilir,
 * başkasının randevusunu iptal edebilir, müşteri listesini öğrenebilir.
 *
 * Meta her POST isteğine `X-Hub-Signature-256` başlığı ekler:
 *
 *     sha256=<gövdenin app secret ile HMAC-SHA256 özeti>
 *
 * ⚠️ İki tuzak:
 *
 *   1. Özet HAM gövde üzerinden hesaplanmalı. JSON.parse edilip yeniden
 *      stringify edilen gövde farklı bayt dizisi üretir (anahtar sırası,
 *      boşluklar, unicode kaçışları) ve imza tutmaz. Bu yüzden app.ts'te
 *      express.json'ın `verify` geri çağrısıyla ham gövde saklanıyor.
 *
 *   2. Karşılaştırma sabit zamanlı olmalı. Normal `===` ilk farklı baytta
 *      döner; saldırgan yanıt sürelerini ölçerek imzayı bayt bayt tahmin
 *      edebilir. `timingSafeEqual` her zaman aynı süreyi harcar.
 */

const SIGNATURE_PREFIX = 'sha256=';

export interface SignatureVerificationResult {
  valid: boolean;
  reason?: string;
}

export function verifyWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string,
): SignatureVerificationResult {
  if (!rawBody || rawBody.length === 0) {
    return { valid: false, reason: 'Ham gövde yok' };
  }

  if (!signatureHeader) {
    return { valid: false, reason: 'İmza başlığı yok' };
  }

  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { valid: false, reason: 'İmza biçimi tanınmadı' };
  }

  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length);

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  // timingSafeEqual eşit uzunluk ister; farklıysa zaten geçersiz.
  if (provided.length !== expected.length) {
    return { valid: false, reason: 'İmza uzunluğu hatalı' };
  }

  const isEqual = timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));

  return isEqual ? { valid: true } : { valid: false, reason: 'İmza eşleşmedi' };
}

/**
 * Meta'nın kurulum sırasındaki GET doğrulama handshake'i.
 *
 * ⚠️ Bu uç olmadan webhook Meta panelinde HİÇ kaydedilemez — kurulum adımı
 * geçilemez. v1 planında yalnızca POST tanımlıydı.
 *
 * Meta şunu çağırır:
 *     GET /webhook/whatsapp?hub.mode=subscribe
 *                          &hub.verify_token=<bizim belirlediğimiz>
 *                          &hub.challenge=<rastgele sayı>
 *
 * Doğru jetonu görürsek `hub.challenge` değerini DÜZ METİN olarak geri
 * döndürmeliyiz. JSON değil.
 */
export function verifyWebhookChallenge(
  mode: string | undefined,
  token: string | undefined,
  expectedToken: string,
): boolean {
  if (mode !== 'subscribe' || !token) return false;

  const provided = Buffer.from(token, 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');

  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
