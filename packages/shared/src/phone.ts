/**
 * Türkiye cep telefonu numaralarının normalleştirilmesi ve maskelenmesi.
 *
 * Numaralar veritabanında **her zaman E.164** formatında tutulur: +905321234567
 * WhatsApp da numaraları bu formatta gönderir, dolayısıyla tek format kullanmak
 * "aynı müşteri iki kayıt oldu" sınıfı hataları tamamen ortadan kaldırır.
 */

/** Türkiye cep telefonu numarası: +90 5XX XXX XX XX */
const E164_TR_MOBILE = /^\+905\d{9}$/;

/**
 * Kullanıcıdan/WhatsApp'tan gelen numarayı E.164'e çevirir.
 *
 * Kabul edilen girişler:
 *   0532 123 45 67 · 05321234567 · 532 123 45 67 · +90 532 123 45 67 · 905321234567
 *   00905321234567 (uluslararası erişim kodu "00" ile)
 *
 * @returns E.164 formatında numara, geçersizse `null`
 */
export function normalizePhone(input: string): string | null {
  if (!input) return null;

  // Rakam dışındaki her şeyi at (boşluk, tire, parantez, artı)
  let digits = input.replace(/\D/g, '');

  // Uluslararası erişim kodu "00" + ülke kodu 90 → düz "90" gibi ele al
  // (0090532... → 90532...). Bu adım ülke kodu kontrolünden ÖNCE gelmeli,
  // aksi halde tek bir "0" atılıp geri kalan basamak sayısı tutmaz.
  if (digits.startsWith('0090')) {
    digits = digits.slice(2);
  }

  // Ülke kodu 90 ile başlıyorsa at
  if (digits.startsWith('90')) {
    digits = digits.slice(2);
  }

  // Baştaki 0'ı at (0532... → 532...)
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Bu noktada elimizde 10 haneli, 5 ile başlayan bir cep numarası olmalı
  if (digits.length !== 10 || !digits.startsWith('5')) {
    return null;
  }

  const e164 = `+90${digits}`;
  return E164_TR_MOBILE.test(e164) ? e164 : null;
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

/**
 * Loglarda ve hata raporlarında kullanılmak üzere numarayı maskeler.
 * KVKK gereği ham telefon numarası log'a yazılmaz.
 *
 *   +905321234567 → +9053****567
 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return '***';
  return `${phone.slice(0, 5)}****${phone.slice(-3)}`;
}

/**
 * Panelde gösterim için okunabilir format.
 *
 *   +905321234567 → 0532 123 45 67
 */
export function formatPhoneForDisplay(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return phone;

  const d = normalized.slice(3); // ülke kodunu at → 5321234567
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8, 10)}`;
}
