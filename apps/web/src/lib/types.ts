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
