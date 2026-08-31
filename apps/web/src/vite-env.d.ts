/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Dükkanın telefon numarası — YALNIZCA sunucuya ulaşılamadığında
   * gösterilen hata ekranı için. Normal akışta numara `/shop` yanıtından
   * geliyor; bu değer, o istek başarısız olduğunda müşterinin elinde bir
   * iletişim yolu kalsın diye derleme zamanında gömülüyor.
   */
  readonly VITE_CONTACT_PHONE?: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
