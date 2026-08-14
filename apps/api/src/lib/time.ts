/**
 * Saat dilimi yardımcıları.
 *
 * Kural: veritabanında her zaman UTC anı (TIMESTAMPTZ) tutulur. Yerel saat
 * yalnızca kullanıcıya gösterirken ve çalışma saatlerini yorumlarken devreye girer.
 *
 * Türkiye 2016'dan beri kalıcı UTC+3 ve yaz saati uygulamıyor — ama burada
 * offset'i sabit yazmıyoruz. Fonksiyonlar Intl üzerinden gerçek offset'i
 * hesaplıyor, böylece dükkan başka bir saat dilimine taşınırsa da doğru çalışır.
 */

import { DAY_NAMES_TR, MONTH_NAMES_TR } from '@berber/shared';

/** "09:30" → { hour: 9, minute: 30 }. Geçersizse hata fırlatır. */
export function parseTimeString(time: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    throw new Error(`Geçersiz saat biçimi: "${time}" (SS:DD bekleniyordu)`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** "2026-08-12" → { year: 2026, month: 8, day: 12 }. Geçersizse hata fırlatır. */
export function parseDateString(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Geçersiz tarih biçimi: "${date}" (YYYY-AA-GG bekleniyordu)`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Geçersiz tarih: "${date}"`);
  }
  return { year, month, day };
}

/**
 * Bir UTC anının, verilen saat diliminde kaç dakika offset'e denk geldiğini bulur.
 * Örn. Europe/Istanbul için her zaman +180.
 */
function getOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Saat dilimi çözümlenemedi: ${timeZone}`);
    return Number(part.value);
  };

  // Intl 24:00'ı gece yarısı için kullanabiliyor; 0'a normalize et.
  const hour = get('hour') % 24;

  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));

  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * Yerel tarih + saat kombinasyonunu UTC anına çevirir.
 *
 *   zonedTimeToUtc('2026-08-12', '09:00', 'Europe/Istanbul')
 *     → 2026-08-12T06:00:00.000Z
 *
 * İki geçişli hesap: ilk tahminin offset'iyle düzeltiyor, sonra düzeltilmiş
 * anın offset'iyle bir kez daha kontrol ediyor. Bu, yaz saati geçiş günlerinde
 * de doğru sonuç verir (Türkiye'de gerekmiyor ama taşınabilirlik için duruyor).
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const { year, month, day } = parseDateString(date);
  const { hour, minute } = parseTimeString(time);

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const firstGuess = new Date(naiveUtc - getOffsetMinutes(new Date(naiveUtc), timeZone) * 60_000);
  const secondOffset = getOffsetMinutes(firstGuess, timeZone);
  const corrected = new Date(naiveUtc - secondOffset * 60_000);

  return corrected;
}

/** Bir UTC anının verilen saat dilimindeki yerel bileşenleri. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Pazar ... 6 = Cumartesi */
  dayOfWeek: number;
}

export function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Saat dilimi çözümlenemedi: ${timeZone}`);
    return part.value;
  };

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const weekday = weekdayMap[get('weekday')];
  if (weekday === undefined) {
    throw new Error(`Gün adı çözümlenemedi: ${get('weekday')}`);
  }

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    dayOfWeek: weekday,
  };
}

/** Yerel saat gösterimi: "09:00" */
export function formatLocalTime(instant: Date, timeZone: string): string {
  const { hour, minute } = getZonedParts(instant, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Yerel tarih gösterimi: "2026-08-12" */
export function formatLocalDate(instant: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Okunabilir Türkçe tarih: "Pazartesi, 12 Ağustos".
 *
 * Chatbot ve müşteri bildirimleri (panelden iptal/erteleme) aynı biçimi
 * kullansın diye burada — iki ayrı yerde tutulursa biri değişince diğeri
 * unutulur.
 */
export function formatDateTr(date: string, timeZone: string): string {
  const { year, month, day } = parseDateString(date);
  const dayOfWeek = getZonedParts(new Date(Date.UTC(year, month - 1, day, 12)), timeZone).dayOfWeek;
  return `${DAY_NAMES_TR[dayOfWeek]}, ${day} ${MONTH_NAMES_TR[month - 1]}`;
}

/** Verilen yerel tarihin başlangıcı (00:00) ve ertesi günün başlangıcı. */
export function localDayBounds(
  date: string,
  timeZone: string,
): { start: Date; end: Date } {
  const start = zonedTimeToUtc(date, '00:00', timeZone);

  const { year, month, day } = parseDateString(date);
  // Ay/yıl taşmasını Date'e hesaplatıyoruz
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDateStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;

  const end = zonedTimeToUtc(nextDateStr, '00:00', timeZone);
  return { start, end };
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

/** [aStart, aEnd) ile [bStart, bEnd) çakışıyor mu? Bitiş hariç. */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
