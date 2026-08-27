/**
 * Tarih yardımcıları.
 *
 * ⚠️ Buradaki her şey DÜKKANIN saat dilimine göre çalışır, ziyaretçinin
 * cihazına göre değil. Müşteri yurt dışından ya da saati yanlış kurulmuş bir
 * telefondan girdiğinde "bugün"ün dükkandaki bugün olması gerekiyor; aksi
 * halde tarih şeridi bir gün kayar ve müşteri gerçekte var olmayan bir güne
 * randevu almaya çalışır.
 */

const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const DAY_NAMES_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/**
 * Dükkanın saat dilimindeki bugünün tarihi ("2026-08-16").
 *
 * `en-CA` yerel ayarı seçildi çünkü tam olarak YYYY-MM-DD üretiyor —
 * elle parça birleştirmeye göre hem kısa hem hataya kapalı.
 */
export function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** "2026-08-16" + 3 → "2026-08-19". Ay/yıl taşmasını Date halleder. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Tarih şeridi: bugünden başlayarak `count` günlük liste.
 *
 * `count`, sunucudan gelen `maxAdvanceDays + 1` olmalı — bugün de dahil
 * olduğu için. Sınırı burada sabit yazmıyoruz; tek doğruluk kaynağı
 * veritabanındaki `shops.max_advance_days`.
 */
export function buildDateStrip(timezone: string, count: number): string[] {
  const today = todayInTimezone(timezone);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

function partsOf(date: string): { year: number; month: number; day: number; weekday: number } {
  const [year, month, day] = date.split('-').map(Number);
  // Öğle vakti kullanılıyor: gün ortasında olduğumuz için saat dilimi
  // kaymaları haftanın gününü değiştiremez.
  const dt = new Date(Date.UTC(year!, month! - 1, day!, 12));
  return { year: year!, month: month!, day: day!, weekday: dt.getUTCDay() };
}

/** "16 Ağustos Cumartesi" */
export function formatDateLong(date: string): string {
  const { month, day, weekday } = partsOf(date);
  return `${day} ${MONTH_NAMES[month - 1]} ${DAY_NAMES[weekday]}`;
}

/** Tarih şeridindeki kutucuk için: { weekday: "Cmt", day: "16", month: "Ağu" } */
export function formatDateChip(date: string): { weekday: string; day: string; month: string } {
  const { month, day, weekday } = partsOf(date);
  return {
    weekday: DAY_NAMES_SHORT[weekday]!,
    day: String(day),
    month: MONTH_NAMES[month - 1]!.slice(0, 3),
  };
}

/** Randevu anını dükkan saatiyle "16 Ağustos Cumartesi, 09:00" olarak yazar. */
export function formatAppointmentMoment(isoString: string, timezone: string): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoString));

  const time = new Intl.DateTimeFormat('tr-TR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString));

  return `${formatDateLong(date)}, ${time}`;
}

/** Fiyatı gösterilebilir hale getirir; girilmemişse null döner. */
export function formatPrice(price: number | null): string | null {
  if (price === null || price === undefined) return null;
  return `${new Intl.NumberFormat('tr-TR').format(price)} ₺`;
}

/**
 * "45 dk", "1 sa", "1 sa 30 dk"
 *
 * Bir saati aşan süreler dakika olarak yazıldığında ("90 dk") okunması
 * zorlaşıyor; çoklu hizmet seçimiyle bu süreler artık olağan.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} dk`;

  const saat = Math.floor(minutes / 60);
  const kalan = minutes % 60;

  return kalan === 0 ? `${saat} sa` : `${saat} sa ${kalan} dk`;
}

/**
 * "2026-08-23" → haftanın günü (0 = Pazar).
 *
 * Öğle vakti üzerinden hesaplanıyor: gün başında/sonunda saat dilimi kayması
 * tarihi bir gün öteleyebiliyor, öğlen böyle bir risk taşımıyor.
 */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay();
}
