import { describe, it, expect } from 'vitest';
import { normalizePhone, isValidPhone, maskPhone, formatPhoneForDisplay } from './phone.js';

describe('normalizePhone', () => {
  it('aynı numaranın tüm yazım biçimlerini tek forma indirger', () => {
    // Bu testin asıl amacı: müşteri numarasını farklı yazsa da
    // veritabanında tek kayıt oluşmalı.
    const variants = [
      '0532 123 45 67',
      '05321234567',
      '532 123 45 67',
      '5321234567',
      '+90 532 123 45 67',
      '+905321234567',
      '905321234567',
      '0 (532) 123-45-67',
      '0090 532 123 45 67',
      '00905321234567',
    ];

    for (const variant of variants) {
      expect(normalizePhone(variant), `girdi: ${variant}`).toBe('+905321234567');
    }
  });

  it('tüm Türk operatör ön eklerini kabul eder', () => {
    for (const prefix of ['501', '505', '530', '535', '542', '553', '561', '599']) {
      expect(normalizePhone(`0${prefix}1234567`)).toBe(`+90${prefix}1234567`);
    }
  });

  it('sabit hat numaralarını reddeder', () => {
    expect(normalizePhone('02121234567')).toBeNull(); // İstanbul sabit hat
    expect(normalizePhone('03121234567')).toBeNull(); // Ankara sabit hat
  });

  it('geçersiz girdileri reddeder', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('05321234')).toBeNull(); // çok kısa
    expect(normalizePhone('053212345678')).toBeNull(); // çok uzun
    expect(normalizePhone('merhaba')).toBeNull();
    expect(normalizePhone('+1 555 123 4567')).toBeNull(); // ABD numarası
  });
});

describe('isValidPhone', () => {
  it('geçerli ve geçersiz numaraları ayırt eder', () => {
    expect(isValidPhone('0532 123 45 67')).toBe(true);
    expect(isValidPhone('02121234567')).toBe(false);
  });
});

describe('maskPhone', () => {
  it('log güvenliği için orta haneleri gizler', () => {
    // KVKK: ham numara log'a yazılmaz
    const masked = maskPhone('+905321234567');
    expect(masked).toBe('+9053****567');
    expect(masked).not.toContain('1234');
  });

  it('kısa girdide bilgi sızdırmaz', () => {
    expect(maskPhone('123')).toBe('***');
  });
});

describe('formatPhoneForDisplay', () => {
  it('panelde okunabilir biçime çevirir', () => {
    expect(formatPhoneForDisplay('+905321234567')).toBe('0532 123 45 67');
  });

  it('çevrilemeyen girdiyi olduğu gibi bırakır', () => {
    expect(formatPhoneForDisplay('bilinmeyen')).toBe('bilinmeyen');
  });
});
