import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * İstemci IP'sinin geri döndürülemez özeti.
 *
 * ── Neden ham IP saklanmıyor? ─────────────────────────────────────
 *
 * IP kişisel veridir (KVKK). Bize gereken şey kimin bağlandığı DEĞİL,
 * yalnızca "bu iki randevu aynı yerden mi geldi?" sorusunun cevabı. HMAC
 * özeti bu soruyu cevaplıyor ama özetten IP'ye geri dönülemiyor.
 *
 * Anahtar olarak sunucunun mevcut gizli anahtarı kullanılıyor: anahtar
 * bilinmeden bir IP'nin özeti hesaplanamaz, yani veritabanını ele geçiren
 * biri bile "şu IP burada mı?" diye arayamaz.
 *
 * ⚠️ Anahtar değişirse eski özetler yeni özetlerle eşleşmez. Sonucu zararsız:
 * kötüye kullanım sayaçları sıfırlanmış gibi olur, veri kaybı olmaz.
 */
export function hashClientIp(ip: string | undefined | null): string | null {
  if (!ip) return null;

  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(ip)
    .digest('hex')
    .slice(0, 32);
}
