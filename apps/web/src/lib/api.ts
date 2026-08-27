import type { ShopInfo, Slot, CreatedAppointment, AppointmentDetail, EmptySlotsReason } from './types';

/**
 * Herkese açık API istemcisi.
 *
 * Panelin `lib/api.ts`'inden çok daha basit ve bu bilinçli: burada jeton
 * yenileme, oturum yönetimi, yetki hatası ele alma yok — çünkü giriş yok.
 * Aynı origin üzerinden konuşuluyor (Caddy /api'yi backend'e veriyor), bu
 * yüzden CORS ve çerez derdi de yok.
 */

const BASE = '/api/v1/public';

/** Sunucudan gelen anlamlı hata mesajını taşır. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    // Ağ hatası — sunucudan bir yanıt hiç gelmedi.
    throw new ApiError(
      'İnternet bağlantınızı kontrol edip tekrar deneyin.',
      'NETWORK_ERROR',
      0,
    );
  }

  if (!res.ok) {
    // Hata gövdesi her zaman JSON olmayabilir (ör. proxy 502'si).
    const body = await res.json().catch(() => null);

    throw new ApiError(
      body?.error?.message ?? 'Bir şeyler ters gitti. Lütfen tekrar deneyin.',
      body?.error?.code ?? 'UNKNOWN',
      res.status,
    );
  }

  return res.json() as Promise<T>;
}

export function fetchShopInfo(): Promise<ShopInfo> {
  return callApi<ShopInfo>('/shop');
}

/**
 * Boş saatler.
 *
 * Hizmetlerin TAMAMI gönderiliyor: saat listesi randevunun süresine bağlı ve
 * süre seçilen kümeden hesaplanıyor ("Saç + Lazer" 90 dakika sürüyor, 45
 * dakikalık boşluklar bu randevuya uygun değil).
 */
export function fetchSlots(
  barberId: string,
  serviceIds: string[],
  date: string,
): Promise<{ slots: Slot[]; reason: EmptySlotsReason | null }> {
  const query = new URLSearchParams({ barberId, serviceIds: serviceIds.join(','), date });
  return callApi<{ slots: Slot[]; reason: EmptySlotsReason | null }>(
    `/slots?${query.toString()}`,
  );
}

export function createAppointment(input: {
  barberId: string;
  serviceIds: string[];
  startsAt: string;
  customerName: string;
  customerPhone: string;
}): Promise<CreatedAppointment> {
  return callApi<CreatedAppointment>('/appointments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchAppointment(token: string): Promise<{ appointment: AppointmentDetail }> {
  return callApi<{ appointment: AppointmentDetail }>(`/appointments/${token}`);
}

export function cancelAppointment(token: string): Promise<{ ok: boolean }> {
  return callApi<{ ok: boolean }>(`/appointments/${token}/cancel`, { method: 'POST' });
}
