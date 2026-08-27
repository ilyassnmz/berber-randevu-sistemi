import { describe, it, expect } from 'vitest';
import {
  computeAppointmentDuration,
  pickPrimaryService,
  sumServicePrices,
  formatServiceNames,
} from './duration.js';

/** Bugünkü dükkanın kurulumu: her hizmet 45 dk, yalnızca Lazer ayrı zaman ister. */
const sac = { durationMin: 45, requiresOwnSlot: false };
const sakal = { durationMin: 45, requiresOwnSlot: false };
const agda = { durationMin: 45, requiresOwnSlot: false };
const lazer = { durationMin: 45, requiresOwnSlot: true };

describe('computeAppointmentDuration', () => {
  it('tek hizmet kendi süresi kadar sürer', () => {
    expect(computeAppointmentDuration([sac])).toBe(45);
  });

  it('aynı oturumda yapılabilen iki hizmet süreyi UZATMAZ', () => {
    expect(computeAppointmentDuration([sac, agda])).toBe(45);
    expect(computeAppointmentDuration([sac, sakal, agda])).toBe(45);
  });

  it('ayrı zaman isteyen hizmet, yanında başka hizmet varsa bir oturum ekler', () => {
    expect(computeAppointmentDuration([sac, lazer])).toBe(90);
    expect(computeAppointmentDuration([sac, agda, lazer])).toBe(90);
  });

  it('ayrı zaman isteyen hizmet TEK BAŞINA seçilirse kendi süresi kadar sürer', () => {
    // Berberin kararı: yalnız lazer için ikinci bir slot kapatmaya gerek yok.
    expect(computeAppointmentDuration([lazer])).toBe(45);
  });

  it('aynı oturumdaki hizmetlerin en uzunu belirleyicidir', () => {
    const boyama = { durationMin: 90, requiresOwnSlot: false };
    expect(computeAppointmentDuration([sac, boyama])).toBe(90);
    expect(computeAppointmentDuration([sac, boyama, lazer])).toBe(135);
  });

  it('boş liste hata verir', () => {
    expect(() => computeAppointmentDuration([])).toThrow();
  });
});

describe('pickPrimaryService', () => {
  it('menüde önce gelen hizmeti seçer', () => {
    const secilenler = [
      { id: 'b', sortOrder: 4 },
      { id: 'a', sortOrder: 1 },
    ];
    expect(pickPrimaryService(secilenler).id).toBe('a');
  });

  it('sıra eşitse kararlı davranır — aynı küme her zaman aynı sonucu verir', () => {
    const kume = [
      { id: 'y', sortOrder: 2 },
      { id: 'x', sortOrder: 2 },
    ];
    expect(pickPrimaryService(kume).id).toBe('x');
    expect(pickPrimaryService([...kume].reverse()).id).toBe('x');
  });
});

describe('sumServicePrices', () => {
  it('fiyatları toplar — süreden farklı olarak ücretler birikir', () => {
    expect(sumServicePrices([{ price: 200 }, { price: 150 }])).toBe(350);
  });

  it('hiç fiyat girilmemişse null döner', () => {
    expect(sumServicePrices([{ price: null }, { price: null }])).toBeNull();
  });

  it('bir kısmı girilmişse girilenlerin toplamını döner', () => {
    expect(sumServicePrices([{ price: 200 }, { price: null }])).toBe(200);
  });
});

describe('formatServiceNames', () => {
  it('adları birleştirir', () => {
    expect(formatServiceNames([{ name: 'Saç' }, { name: 'Ağda' }])).toBe('Saç + Ağda');
  });
});

describe('sumServicePrices — metin fiyat savunması', () => {
  it('metin olarak gelen fiyatları BİRLEŞTİRMEZ, toplar', () => {
    // Canlıda yaşandı: fiyatlar API'den "500" / "2000" olarak geldi ve
    // ekranda 5.002.000 ₺ göründü.
    const metinFiyatlar = [{ price: '500' }, { price: '2000' }] as unknown as Array<{
      price: number | null;
    }>;
    expect(sumServicePrices(metinFiyatlar)).toBe(2500);
  });
});
