import { describe, it, expect } from 'vitest';
import {
  zonedTimeToUtc,
  getZonedParts,
  formatLocalTime,
  formatLocalDate,
  localDayBounds,
  intervalsOverlap,
  parseTimeString,
  parseDateString,
} from './time.js';

const TZ = 'Europe/Istanbul';

describe('zonedTimeToUtc', () => {
  it('İstanbul yerel saatini doğru UTC anına çevirir', () => {
    // Türkiye kalıcı UTC+3 → 09:00 yerel = 06:00 UTC
    expect(zonedTimeToUtc('2026-08-12', '09:00', TZ).toISOString()).toBe(
      '2026-08-12T06:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-08-12', '20:15', TZ).toISOString()).toBe(
      '2026-08-12T17:15:00.000Z',
    );
  });

  it('kışın da aynı offseti kullanır (Türkiye yaz saati uygulamıyor)', () => {
    // Bu test, birinin "yaz saati desteği" ekleyip Türkiye'yi bozmasına karşı koruma
    expect(zonedTimeToUtc('2026-01-15', '09:00', TZ).toISOString()).toBe(
      '2026-01-15T06:00:00.000Z',
    );
  });

  it('gece yarısını doğru çevirir', () => {
    expect(zonedTimeToUtc('2026-08-12', '00:00', TZ).toISOString()).toBe(
      '2026-08-11T21:00:00.000Z',
    );
  });

  it('yaz saati uygulayan bir dilimde de doğru çalışır', () => {
    // Taşınabilirlik kontrolü: Berlin yazın UTC+2, kışın UTC+1
    expect(zonedTimeToUtc('2026-07-15', '12:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-07-15T10:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-01-15', '12:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-01-15T11:00:00.000Z',
    );
  });
});

describe('getZonedParts', () => {
  it('UTC anını yerel bileşenlere ayırır', () => {
    const parts = getZonedParts(new Date('2026-08-12T06:00:00.000Z'), TZ);
    expect(parts).toEqual({
      year: 2026,
      month: 8,
      day: 12,
      hour: 9,
      minute: 0,
      dayOfWeek: 3, // Çarşamba
    });
  });

  it('gün sınırında doğru tarihi verir', () => {
    // 21:00 UTC = ertesi gün 00:00 İstanbul
    const parts = getZonedParts(new Date('2026-08-11T21:00:00.000Z'), TZ);
    expect(parts.day).toBe(12);
    expect(parts.hour).toBe(0);
  });

  it('haftanın gününü JavaScript ile aynı numaralandırır', () => {
    // 2026-08-09 Pazar
    expect(getZonedParts(new Date('2026-08-09T09:00:00.000Z'), TZ).dayOfWeek).toBe(0);
    // 2026-08-15 Cumartesi
    expect(getZonedParts(new Date('2026-08-15T09:00:00.000Z'), TZ).dayOfWeek).toBe(6);
  });
});

describe('formatLocalTime / formatLocalDate', () => {
  it('yerel saati ve tarihi biçimlendirir', () => {
    const instant = new Date('2026-08-12T06:00:00.000Z');
    expect(formatLocalTime(instant, TZ)).toBe('09:00');
    expect(formatLocalDate(instant, TZ)).toBe('2026-08-12');
  });

  it('gece yarısını 00:00 olarak gösterir (24:00 değil)', () => {
    const instant = new Date('2026-08-11T21:00:00.000Z');
    expect(formatLocalTime(instant, TZ)).toBe('00:00');
  });
});

describe('localDayBounds', () => {
  it('yerel günün sınırlarını verir', () => {
    const { start, end } = localDayBounds('2026-08-12', TZ);
    expect(start.toISOString()).toBe('2026-08-11T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-12T21:00:00.000Z');
  });

  it('ay sonunda taşmayı doğru hesaplar', () => {
    const { end } = localDayBounds('2026-08-31', TZ);
    expect(formatLocalDate(end, TZ)).toBe('2026-09-01');
  });

  it('yıl sonunda taşmayı doğru hesaplar', () => {
    const { end } = localDayBounds('2026-12-31', TZ);
    expect(formatLocalDate(end, TZ)).toBe('2027-01-01');
  });
});

describe('intervalsOverlap', () => {
  const d = (iso: string) => new Date(iso);

  it('bitişik aralıkları çakışma saymaz', () => {
    // 09:00–09:45 ile 09:45–10:30 → çakışmaz.
    // Bu davranış kritik: aksi halde her randevu bir sonrakini bloke ederdi.
    expect(
      intervalsOverlap(
        d('2026-08-12T09:00:00Z'),
        d('2026-08-12T09:45:00Z'),
        d('2026-08-12T09:45:00Z'),
        d('2026-08-12T10:30:00Z'),
      ),
    ).toBe(false);
  });

  it('kısmi çakışmayı yakalar', () => {
    expect(
      intervalsOverlap(
        d('2026-08-12T09:00:00Z'),
        d('2026-08-12T09:45:00Z'),
        d('2026-08-12T09:30:00Z'),
        d('2026-08-12T10:15:00Z'),
      ),
    ).toBe(true);
  });

  it('içine gömülü aralığı yakalar', () => {
    expect(
      intervalsOverlap(
        d('2026-08-12T09:00:00Z'),
        d('2026-08-12T11:00:00Z'),
        d('2026-08-12T09:30:00Z'),
        d('2026-08-12T10:00:00Z'),
      ),
    ).toBe(true);
  });

  it('ayrık aralıkları çakışma saymaz', () => {
    expect(
      intervalsOverlap(
        d('2026-08-12T09:00:00Z'),
        d('2026-08-12T09:45:00Z'),
        d('2026-08-12T14:00:00Z'),
        d('2026-08-12T14:45:00Z'),
      ),
    ).toBe(false);
  });
});

describe('parseTimeString / parseDateString', () => {
  it('geçerli girdileri ayrıştırır', () => {
    expect(parseTimeString('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseDateString('2026-08-12')).toEqual({ year: 2026, month: 8, day: 12 });
  });

  it('geçersiz girdide sessizce yanlış sonuç üretmez, hata fırlatır', () => {
    expect(() => parseTimeString('25:00')).toThrow();
    expect(() => parseTimeString('9:00')).toThrow();
    expect(() => parseTimeString('')).toThrow();
    expect(() => parseDateString('12/08/2026')).toThrow();
    expect(() => parseDateString('2026-13-01')).toThrow();
  });
});
