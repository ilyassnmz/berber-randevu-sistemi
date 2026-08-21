import {
  zonedTimeToUtc,
  getZonedParts,
  formatLocalTime,
  addMinutes,
  intervalsOverlap,
  parseDateString,
} from '../lib/time.js';

/**
 * ══════════════════════════════════════════════════════════════════
 *  SLOT MOTORU
 * ══════════════════════════════════════════════════════════════════
 *
 * Bir berberin belirli bir gündeki müsait randevu saatlerini hesaplar.
 *
 * ── Tasarım notu: neden sabit saat listesi değil? ──────────────────
 *
 * Bugün her hizmet 45 dakika, dolayısıyla sonuç sabit bir ızgarayla
 * (09:00, 09:45, 10:30 ...) birebir aynı. Ama motor sabit liste yerine
 * ARALIK ÇAKIŞMASI hesaplıyor.
 *
 * Kazanç: ileride "boyama 90 dakika" demek istendiğinde tek bir
 * `UPDATE services SET duration_min = 90` yetiyor. Sabit ızgara yazsaydık
 * motoru baştan yazmak gerekirdi.
 *
 * ⚠️ Bu dosyada 45 sayısı GEÇMEZ. Süre `serviceDurationMin`, adım
 * `slotStepMin` parametresinden gelir; ikisi de veritabanından okunur.
 *
 * ── Neden saf fonksiyon? ──────────────────────────────────────────
 *
 * Veritabanına hiç dokunmuyor — girdi olarak veriyi alıyor. Böylece
 * hatalarının yaşayacağı bu modül, veritabanı olmadan tam olarak test
 * edilebiliyor (slots.test.ts).
 */

export interface WorkingHoursInput {
  startTime: string; // "09:00" — dükkanın yerel saati
  endTime: string; // "20:15"
  isWorking: boolean;
}

export interface IntervalInput {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotEngineInput {
  /** Hangi yerel gün için hesaplanıyor. "2026-08-12" */
  date: string;
  timezone: string;

  /** shops.slot_step_min — aday başlangıçlar arası dakika. */
  slotStepMin: number;

  /** services.duration_min — randevunun süreceği dakika. */
  serviceDurationMin: number;

  /** shops.max_advance_days — bu kadar gün sonrasına randevu verilmez. */
  maxAdvanceDays: number;

  /** O günün haftalık çalışma düzeni. Kayıt yoksa null. */
  workingHours: WorkingHoursInput | null;

  /** İzinler ve molalar (dükkan geneli + berbere özel, çağıran birleştirir). */
  timeOff: readonly IntervalInput[];

  /** O gün berberde bulunan, slotu bloke eden randevular. */
  appointments: readonly IntervalInput[];

  /** "Şimdi" — geçmiş saatleri elemek için. Testlerde sabitlenir. */
  now: Date;

  /**
   * Geçmiş saatler de listelensin mi?
   *
   * ⚠️ Varsayılan BİLEREK false: randevu ALMAK için geçmiş saat asla
   * geçerli değildir ve `isSlotBookable` bu fonksiyona dayanıyor.
   *
   * Yalnızca PANELİN gün görünümü true veriyor. Berber saat 18:45'te
   * dükkandayken sabah 09:00'da kimin geldiğini görebilmeli; geçmiş
   * saatler elenince o randevular da ekrandan kayboluyordu.
   */
  includePast?: boolean;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  /** Yerel saat gösterimi: "09:00" */
  label: string;

  /**
   * Bu saat geçmişte mi?
   *
   * Arayüz bunu soluk göstermek ve tıklamayı engellemek için kullanıyor —
   * geçmiş bir saate randevu yazılamaz, sunucu zaten reddeder.
   */
  isPast: boolean;
}

/**
 * Müsait slotları hesaplar.
 *
 * Sıra önemli: en ucuz elemeler önce yapılır (kapalı gün → tek sorgu bile
 * çalıştırmadan boş dönülür).
 */
export function computeAvailableSlots(input: SlotEngineInput): Slot[] {
  const {
    date,
    timezone,
    slotStepMin,
    serviceDurationMin,
    maxAdvanceDays,
    workingHours,
    timeOff,
    appointments,
    now,
    includePast = false,
  } = input;

  // Savunma: bozuk yapılandırma sessizce garip sonuç üretmesin
  if (slotStepMin <= 0) {
    throw new Error(`slotStepMin pozitif olmalı, gelen: ${slotStepMin}`);
  }
  if (serviceDurationMin <= 0) {
    throw new Error(`serviceDurationMin pozitif olmalı, gelen: ${serviceDurationMin}`);
  }

  // ── 1. O gün çalışılmıyor mu? ────────────────────────────
  if (!workingHours || !workingHours.isWorking) {
    return [];
  }

  // ── 2. Tarih izin verilen aralıkta mı? ───────────────────
  if (!isDateWithinBookingWindow(date, timezone, maxAdvanceDays, now)) {
    return [];
  }

  // ── 3. Günün çalışma aralığını UTC anlarına çevir ────────
  const dayStart = zonedTimeToUtc(date, workingHours.startTime, timezone);
  const dayEnd = zonedTimeToUtc(date, workingHours.endTime, timezone);

  if (dayEnd <= dayStart) {
    // Bozuk çalışma saati kaydı; slot üretmek yerine boş dön.
    return [];
  }

  // ── 4. Aday başlangıçları üret ve ele ────────────────────
  const slots: Slot[] = [];

  for (
    let candidate = dayStart;
    candidate < dayEnd;
    candidate = addMinutes(candidate, slotStepMin)
  ) {
    const candidateEnd = addMinutes(candidate, serviceDurationMin);

    // Hizmet gün kapanışını aşıyorsa bu ve sonraki adaylar da aşar
    if (candidateEnd > dayEnd) break;

    // Geçmiş saat: normalde elenir, panel gün görünümünde işaretlenip
    // listede bırakılır.
    const isPast = candidate <= now;
    if (isPast && !includePast) continue;

    // İzin / mola ile çakışma
    if (overlapsAny(candidate, candidateEnd, timeOff)) continue;

    // Mevcut randevu ile çakışma
    if (overlapsAny(candidate, candidateEnd, appointments)) continue;

    slots.push({
      startsAt: candidate,
      endsAt: candidateEnd,
      label: formatLocalTime(candidate, timezone),
      isPast,
    });
  }

  return slots;
}

function overlapsAny(start: Date, end: Date, intervals: readonly IntervalInput[]): boolean {
  return intervals.some((i) => intervalsOverlap(start, end, i.startsAt, i.endsAt));
}

/**
 * İstenen yerel gün, bugün ile bugün+maxAdvanceDays arasında mı?
 *
 * Geçmiş günlere ve çok ileri tarihlere randevu verilmez. İkincisi olmadan
 * biri 2029'a randevu alabilir ve takvim kullanılmaz hale gelir.
 */
export function isDateWithinBookingWindow(
  date: string,
  timezone: string,
  maxAdvanceDays: number,
  now: Date,
): boolean {
  const today = getZonedParts(now, timezone);
  const target = parseDateString(date);

  // Gün farkını takvim günü olarak hesapla (saat bileşeni karışmasın)
  const todayUtcMidnight = Date.UTC(today.year, today.month - 1, today.day);
  const targetUtcMidnight = Date.UTC(target.year, target.month - 1, target.day);

  const diffDays = Math.round((targetUtcMidnight - todayUtcMidnight) / 86_400_000);

  return diffDays >= 0 && diffDays <= maxAdvanceDays;
}

/**
 * Belirli bir başlangıç anının, o berber için gerçekten alınabilir bir slot
 * olduğunu doğrular.
 *
 * Randevu OLUŞTURULURKEN kullanılır: müşteriye gösterilen liste ile gerçek
 * arasında zaman geçmiş olabilir, ayrıca panelden serbest saat girilebiliyor.
 *
 * ⚠️ Bu kontrol çakışmaya karşı TEK savunma DEĞİLDİR. Yarış durumunu asıl
 * engelleyen, veritabanındaki `appointments_no_overlap` kısıtıdır. Buradaki
 * doğrulama sadece kullanıcıya anlamlı hata mesajı vermek içindir.
 */
export function isSlotBookable(
  startsAt: Date,
  input: Omit<SlotEngineInput, 'now'> & { now: Date },
): boolean {
  // ⚠️ `includePast` BURADA ZORLA kapatılıyor. Çağıran yanlışlıkla true
  // gönderirse geçmişe randevu yazılabilir hale gelirdi; doğrulama
  // fonksiyonu böyle bir seçeneğe tabi olmamalı.
  const slots = computeAvailableSlots({ ...input, includePast: false });
  return slots.some((s) => s.startsAt.getTime() === startsAt.getTime());
}
