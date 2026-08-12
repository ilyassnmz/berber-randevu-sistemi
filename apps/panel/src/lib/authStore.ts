import { create } from 'zustand';
import type { AuthBarber } from './types';

/**
 * Kimlik doğrulama durumu.
 *
 * ⚠️ Erişim jetonu BELLEKTE tutulur, `localStorage`'a yazılmaz. Sayfa
 * yenilenince kaybolur — bu yüzden uygulama açılışında `refresh` çağrılıp
 * httpOnly çerezle sessizce yeni jeton alınır (bkz. api.ts → bootstrapAuth).
 *
 * localStorage'da tutmak, siteye sızan herhangi bir betiğin jetonu
 * okuyabilmesi anlamına gelirdi.
 */
interface AuthState {
  accessToken: string | null;
  barber: AuthBarber | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  setSession: (accessToken: string, barber: AuthBarber) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  barber: null,
  status: 'loading',

  setSession: (accessToken, barber) => set({ accessToken, barber, status: 'authenticated' }),

  clearSession: () => set({ accessToken: null, barber: null, status: 'unauthenticated' }),
}));

/** Store dışından (api.ts gibi React olmayan yerlerden) okumak için. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
