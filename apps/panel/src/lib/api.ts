import { useAuthStore, getAccessToken } from './authStore';
import type { AuthBarber } from './types';

/**
 * API istemcisi.
 *
 * `credentials: 'include'` her istekte gönderiliyor — yenileme çerezi
 * (httpOnly) bunu gerektiriyor.
 *
 * Bir istek 401 dönerse TEK SEFERLİK bir yenileme denenir; başarılıysa
 * istek otomatik tekrarlanır. Yenileme de başarısız olursa oturum kapatılır
 * ve giriş ekranına yönlendirilir. Bu sayede erişim jetonunun süresi
 * (15 dk) dolduğunda kullanıcı fark etmeden çalışmaya devam eder.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;

    const data = (await res.json()) as { accessToken: string; barber: AuthBarber };
    useAuthStore.getState().setSession(data.accessToken, data.barber);
    return true;
  } catch {
    return false;
  }
}

/** Eşzamanlı birden fazla 401 aynı anda tek yenileme isteği paylaşsın. */
function refreshOnce(): Promise<boolean> {
  refreshPromise ??= performRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const token = getAccessToken();

  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  // `body` alanını yalnızca gerçekten varsa ekliyoruz: `exactOptionalPropertyTypes`
  // altında `body: undefined` atamak fetch'in RequestInit tipiyle uyuşmuyor.
  if (options.body) init.body = JSON.stringify(options.body);

  const res = await fetch(buildUrl(path, options.query), init);

  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      json.error?.message ?? 'Bir hata oluştu',
      res.status,
      json.error?.code ?? 'UNKNOWN',
      json.error?.details,
    );
  }

  return json as T;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const refreshed = await refreshOnce();
      if (refreshed) {
        return rawRequest<T>(path, options);
      }
      useAuthStore.getState().clearSession();
    }
    throw error;
  }
}

/**
 * Uygulama açılışında çağrılır: httpOnly çerez geçerliyse yeni erişim
 * jetonu alınır ve kullanıcı otomatik giriş yapmış olur.
 */
export async function bootstrapAuth(): Promise<void> {
  const ok = await refreshOnce();
  if (!ok) {
    useAuthStore.getState().clearSession();
  }
}
