import { describe, it, expect } from 'vitest';
import {
  computeAvailableSlots,
  isDateWithinBookingWindow,
  isSlotBookable,
  type SlotEngineInput,
} from './slots.js';
import { zonedTimeToUtc } from '../lib/time.js';

const TZ = 'Europe/Istanbul';

/** 2026-08-12 Çarşamba. "Şimdi" bir gün öncesi, saat 10:00 yerel. */
const DATE = '2026-08-12';
const NOW_DAY_BEFORE = new Date('2026-08-11T07:00:00.000Z');

/** Test girdisini varsayılanlarla kurar; testler sadece ilgilendikleri alanı geçer. */
function makeInput(overrides: Partial<SlotEngineInput> = {}): SlotEngineInput {
  return {
    date: DATE,
    timezone: TZ,
    slotStepMin: 45,
    serviceDurationMin: 45,
    maxAdvanceDays: 30,
    workingHours: { startTime: '09:00', endTime: '20:15', isWorking: true },
    timeOff: [],
    appointments: [],
    now: NOW_DAY_BEFORE,
    ...overrides,
  };
}

/** Yerel saat aralığını UTC anlarına çevirir: at('09:00', '09:45') */
function at(startTime: string, endTime: string, date = DATE) {
  return {
    startsAt: zonedTimeToUtc(date, startTime, TZ),
    endsAt: zonedTimeToUtc(date, endTime, TZ),
  };
}

const labels = (input: SlotEngineInput) => computeAvailableSlots(input).map((s) => s.label);

describe('computeAvailableSlots — boş gün', () => {
  it('tam çalışma günü için 15 saatin tamamını üretir', () => {
    // Bu, dokümandaki randevu saatleri listesinin birebir karşılığı.
    expect(labels(makeInput())).toEqual([
      '09:00',
      '09:45',
      '10:30',
      '11:15',
      '12:00',
      '12:45',
      '13:30',
      '14:15',
      '15:00',
      '15:45',
      '16:30',
      '17:15',
      '18:00',
      '18:45',
      '19:30',
    ]);
  });

  it('son randevu 19:30\'da başlar ve tam kapanışta biter', () => {
    const slots = computeAvailableSlots(makeInput());
    const last = slots.at(-1);

    expect(last?.label).toBe('19:30');
    // 19:30 + 45 dk = 20:15 = kapanış. Bir dakika bile taşmamalı.
    expect(last?.endsAt.toISOString()).toBe(
      zonedTimeToUtc(DATE, '20:15', TZ).toISOString(),
    );
  });

  it('slotları UTC anı olarak döndürür', () => {
    const first = computeAvailableSlots(makeInput())[0];
    expect(first?.startsAt.toISOString()).toBe('2026-08-12T06:00:00.000Z');
  });
});

describe('computeAvailableSlots — çalışma düzeni', () => {
  it('çalışılmayan günde boş liste döner', () => {
    const input = makeInput({
      workingHours: { startTime: '09:00', endTime: '20:15', isWorking: false },
    });
    expect(computeAvailableSlots(input)).toEqual([]);
  });

  it('çalışma saati kaydı yoksa boş liste döner', () => {
    expect(computeAvailableSlots(makeInput({ workingHours: null }))).toEqual([]);
  });

  it('kısa çalışma gününde daha az slot üretir', () => {
    const input = makeInput({
      workingHours: { startTime: '09:00', endTime: '12:00', isWorking: true },
    });
    // 09:00, 09:45, 10:30 → 11:15 başlarsa 12:00'da biter, o da sığar
    expect(labels(input)).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });

  it('bozuk çalışma saati kaydında (bitiş <= başlangıç) boş döner', () => {
    const input = makeInput({
      workingHours: { startTime: '20:00', endTime: '09:00', isWorking: true },
    });
    expect(computeAvailableSlots(input)).toEqual([]);
  });
});

describe('computeAvailableSlots — mevcut randevular', () => {
  it('dolu saati listeden çıkarır', () => {
    const input = makeInput({ appointments: [at('09:00', '09:45')] });
    const result = labels(input);

    expect(result).not.toContain('09:00');
    expect(result).toContain('09:45');
    expect(result).toHaveLength(14);
  });

  it('bitişik randevular birbirini bloke etmez', () => {
    // En sinsi hata sınıfı: aralık mantığı yanlış kurulursa 09:00–09:45
    // randevusu 09:45 slotunu da yer ve gün yarıya iner.
    const input = makeInput({
      appointments: [at('09:00', '09:45'), at('09:45', '10:30')],
    });
    const result = labels(input);

    expect(result).not.toContain('09:00');
    expect(result).not.toContain('09:45');
    expect(result).toContain('10:30');
    expect(result).toHaveLength(13);
  });

  it('birden fazla dolu saati aynı anda eler', () => {
    const input = makeInput({
      appointments: [at('09:00', '09:45'), at('14:15', '15:00'), at('19:30', '20:15')],
    });
    const result = labels(input);

    expect(result).not.toContain('09:00');
    expect(result).not.toContain('14:15');
    expect(result).not.toContain('19:30');
    expect(result).toHaveLength(12);
  });

  it('gün tamamen doluysa boş liste döner', () => {
    const allSlots = computeAvailableSlots(makeInput());
    const input = makeInput({
      appointments: allSlots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })),
    });
    expect(computeAvailableSlots(input)).toEqual([]);
  });
});

describe('computeAvailableSlots — izin ve molalar', () => {
  it('öğle arasındaki slotları eler', () => {
    // v1 dokümanında bu mümkün değildi; sadece tam gün kapatılabiliyordu.
    const input = makeInput({ timeOff: [at('12:00', '13:30')] });
    const result = labels(input);

    expect(result).not.toContain('12:00');
    expect(result).not.toContain('12:45');
    expect(result).toContain('11:15');
    expect(result).toContain('13:30');
  });

  it('kısmen çakışan izni de dikkate alır', () => {
    // 12:15–12:30 arası kapalı → 12:00 slotu (12:00–12:45) çakışıyor
    const input = makeInput({ timeOff: [at('12:15', '12:30')] });
    expect(labels(input)).not.toContain('12:00');
  });

  it('tam gün izinde boş liste döner', () => {
    const input = makeInput({ timeOff: [at('00:00', '23:59')] });
    expect(computeAvailableSlots(input)).toEqual([]);
  });
});

describe('computeAvailableSlots — zaman penceresi', () => {
  it('bugün için geçmiş saatleri listelemez', () => {
    // "Şimdi" 12:10 yerel → 12:00 geçmiş, 12:45 geçerli
    const input = makeInput({ now: zonedTimeToUtc(DATE, '12:10', TZ) });
    const result = labels(input);

    expect(result).not.toContain('12:00');
    expect(result).not.toContain('09:00');
    expect(result[0]).toBe('12:45');
  });

  it('tam slot saatinde o slotu artık vermez', () => {
    const input = makeInput({ now: zonedTimeToUtc(DATE, '12:00', TZ) });
    expect(labels(input)).not.toContain('12:00');
  });

  it('geçmiş güne randevu vermez', () => {
    const input = makeInput({ now: new Date('2026-08-20T07:00:00.000Z') });
    expect(computeAvailableSlots(input)).toEqual([]);
  });

  it('izin verilen en son güne randevu verir', () => {
    // now = 2026-07-13, hedef 2026-08-12 → tam 30 gün sonra
    const input = makeInput({
      now: zonedTimeToUtc('2026-07-13', '10:00', TZ),
      maxAdvanceDays: 30,
    });
    expect(computeAvailableSlots(input)).toHaveLength(15);
  });

  it('izin verilen aralığın ötesine randevu vermez', () => {
    // 31 gün sonrası
    const input = makeInput({
      now: zonedTimeToUtc('2026-07-12', '10:00', TZ),
      maxAdvanceDays: 30,
    });
    expect(computeAvailableSlots(input)).toEqual([]);
  });
});

describe('computeAvailableSlots — değişken süre', () => {
  // Bugün tüm hizmetler 45 dk. Bu testler, süre veritabanından değiştirildiğinde
  // motorun yeniden yazılmasına gerek olmadığını garanti eder.

  it('90 dakikalık hizmet iki slotluk yer kaplar', () => {
    const input = makeInput({ serviceDurationMin: 90 });
    const result = labels(input);

    // Adaylar yine 45 dk arayla üretilir ama her biri 90 dk yer ister.
    // Son aday 18:45 olabilir (18:45 + 90 = 20:15 = kapanış).
    expect(result.at(-1)).toBe('18:45');
    expect(result).toHaveLength(14);
  });

  it('90 dakikalık hizmette araya sıkışan randevu iki adayı birden eler', () => {
    const input = makeInput({
      serviceDurationMin: 90,
      appointments: [at('10:30', '11:15')],
    });
    const result = labels(input);

    // 09:45 (09:45–11:15) ve 10:30 (10:30–12:00) ikisi de çakışır
    expect(result).not.toContain('09:45');
    expect(result).not.toContain('10:30');
    expect(result).toContain('09:00'); // 09:00–10:30 bitişik, çakışmaz
    expect(result).toContain('11:15');
  });

  it('20 dakikalık hizmet kapanışa daha yakın slot verebilir', () => {
    const input = makeInput({ serviceDurationMin: 20 });
    // Son aday yine 19:30 (ızgara adımı 45 olduğu için), ama 19:50'de biter
    const slots = computeAvailableSlots(input);
    expect(slots.at(-1)?.label).toBe('19:30');
    expect(slots.at(-1)?.endsAt.toISOString()).toBe(
      zonedTimeToUtc(DATE, '19:50', TZ).toISOString(),
    );
  });

  it('slot adımı değiştiğinde ızgara da değişir', () => {
    // 30 dakikalık ızgara, 30 dakikalık hizmet
    const input = makeInput({ slotStepMin: 30, serviceDurationMin: 30 });
    const result = labels(input);

    expect(result.slice(0, 4)).toEqual(['09:00', '09:30', '10:00', '10:30']);

    // Izgara AÇILIŞ SAATİNE sabitlenir, kapanışa değil. 09:00'dan 30'ar dakika
    // sayıldığı için saatler yalnızca :00 ve :30'a düşer — 19:45 bu ızgarada yok.
    // Son aday 19:30 (19:30–20:00); bir sonraki aday 20:00 olurdu ve 20:30'da
    // biteceği için kapanışı aşar.
    expect(result.at(-1)).toBe('19:30');
    expect(result.every((l) => l.endsWith(':00') || l.endsWith(':30'))).toBe(true);
  });

  it('geçersiz süre/adım değerinde sessiz kalmaz, hata fırlatır', () => {
    expect(() => computeAvailableSlots(makeInput({ slotStepMin: 0 }))).toThrow();
    expect(() => computeAvailableSlots(makeInput({ serviceDurationMin: -5 }))).toThrow();
  });
});

describe('isDateWithinBookingWindow', () => {
  const now = zonedTimeToUtc('2026-08-12', '10:00', TZ);

  it('bugünü kabul eder', () => {
    expect(isDateWithinBookingWindow('2026-08-12', TZ, 30, now)).toBe(true);
  });

  it('dünü reddeder', () => {
    expect(isDateWithinBookingWindow('2026-08-11', TZ, 30, now)).toBe(false);
  });

  it('sınırdaki günü kabul, bir sonrakini reddeder', () => {
    expect(isDateWithinBookingWindow('2026-09-11', TZ, 30, now)).toBe(true);
    expect(isDateWithinBookingWindow('2026-09-12', TZ, 30, now)).toBe(false);
  });

  it('gün sonunda bile bugünü hâlâ bugün sayar', () => {
    // 23:50 yerel — saat bileşeni gün karşılaştırmasını bozmamalı
    const lateNow = zonedTimeToUtc('2026-08-12', '23:50', TZ);
    expect(isDateWithinBookingWindow('2026-08-12', TZ, 30, lateNow)).toBe(true);
  });
});

describe('isSlotBookable', () => {
  it('müsait slot için true döner', () => {
    const startsAt = zonedTimeToUtc(DATE, '09:00', TZ);
    expect(isSlotBookable(startsAt, makeInput())).toBe(true);
  });

  it('dolu slot için false döner', () => {
    const startsAt = zonedTimeToUtc(DATE, '09:00', TZ);
    const input = makeInput({ appointments: [at('09:00', '09:45')] });
    expect(isSlotBookable(startsAt, input)).toBe(false);
  });

  it('ızgaraya oturmayan saat için false döner', () => {
    // 09:20 geçerli bir başlangıç değil
    const startsAt = zonedTimeToUtc(DATE, '09:20', TZ);
    expect(isSlotBookable(startsAt, makeInput())).toBe(false);
  });
});
