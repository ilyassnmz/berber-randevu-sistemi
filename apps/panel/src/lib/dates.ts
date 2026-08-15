/**
 * Tarih yardımcıları — panel istemcisi.
 *
 * Saat dilimi `Europe/Istanbul` olarak sabitlendi: tek dükkanlı bu sürümde
 * kullanıcılar (Müslüm, Fırat) her zaman Türkiye'de. Tarayıcının kendi saat
 * dilimine güvenmek yerine `Intl` ile açıkça belirtiyoruz — telefon yanlış
 * ayarlanmış olsa bile takvim doğru günü gösterir.
 */

const TZ = 'Europe/Istanbul';

const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function zonedParts(date: Date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';

  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  };
}

/** Bugünün yerel tarihi: "2026-08-12" */
export function todayLocalDate(): string {
  const p = zonedParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "2026-08-12" tarihine gün ekler/çıkarır. */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/** "2026-08-12" → "Çarşamba, 12 Ağustos" */
export function formatDateTr(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const noon = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const p = zonedParts(noon);
  return `${DAY_NAMES[p.dayOfWeek]}, ${p.day} ${MONTH_NAMES[p.month - 1]}`;
}

/** ISO an → "09:00" (yerel saat) */
export function formatTimeTr(iso: string): string {
  const p = zonedParts(new Date(iso));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function isToday(date: string): boolean {
  return date === todayLocalDate();
}

/**
 * Bir yerel günün tamamını (00:00-23:59:59) UTC ISO aralığına çevirir.
 * Türkiye kalıcı UTC+3 (2016'dan beri yaz saati yok) — bu yüzden sabit
 * "+03:00" ofseti güvenli, `apps/api/src/lib/time.ts`'teki aynı varsayımla
 * tutarlı.
 */
export function localDayRangeIso(date: string): { startsAt: string; endsAt: string } {
  return {
    startsAt: `${date}T00:00:00+03:00`,
    endsAt: `${date}T23:59:59+03:00`,
  };
}
