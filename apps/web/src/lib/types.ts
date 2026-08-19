/**
 * Herkese açık API'nin (`/api/v1/public`) döndürdüğü şekiller.
 *
 * ⚠️ Bunlar backend'deki yanıtların ELLE yazılmış karşılığı. Uçlar
 * değişirse burası da değişmeli — `apps/api/src/routes/public.ts`.
 * Alanlar bilerek dar: backend zaten müşteri telefonu, gelmedi sayacı gibi
 * alanları göndermiyor, tip tarafında da onları beklememeliyiz.
 */

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  /** Kuruş değil, TL. Girilmemişse null — arayüz fiyatı gizler. */
  price: number | null;
}

export interface Barber {
  id: string;
  name: string;
  /**
   * Berberin çalıştığı gün numaraları (0 = Pazar, 6 = Cumartesi).
   *
   * Tarih şeridi kapalı günleri buna göre devre dışı bırakıyor. Bu bilgi
   * olmadan müşteri kapalı bir güne tıklayıp "uygun saat kalmamış" mesajı
   * alıyordu — o mesaj "doldu" anlamına gelir ve kapalı gün için yanıltıcıdır.
   */
  workingDays: number[];
}

export interface ShopInfo {
  shop: {
    name: string;
    timezone: string;
    contactPhone: string | null;
    /** Tarih şeridi bu kadar günle sınırlanır. */
    maxAdvanceDays: number;
    /** Randevuya bu kadar dakikadan az kaldıysa müşteri iptal edemez. */
    cancelCutoffMin: number;
  };
  services: Service[];
  barbers: Barber[];
}

/**
 * Saat listesi boşsa SEBEBİ.
 *
 * Üçü farklı mesaj gerektiriyor: kapalı gün ve izin günü "doldu"
 * DEĞİLdir. "Doldu" demek müşteriye "erken davransam kapardım" hissi
 * verir; berber izinliyse o gün ne yapsa yer açılmaz.
 */
export type EmptySlotsReason = 'closed' | 'timeoff' | 'full';

export interface Slot {
  startsAt: string;
  /** Sunucuda dükkanın saat diliminde üretilmiş gösterim: "09:00". */
  label: string;
}

export interface CreatedAppointment {
  token: string;
  appointment: {
    startsAt: string;
    status: string;
    barberName: string;
    serviceName: string;
    servicePrice: number | null;
    customerName: string | null;
  };
}

export interface AppointmentDetail {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  cancelReason: string | null;
  barberName: string;
  serviceName: string;
  servicePrice: number | null;
  customerName: string | null;
}
