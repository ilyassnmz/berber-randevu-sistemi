/**
 * Chatbot durum makinesi — durumlar ve taşınan veri.
 *
 * Durum `chat_sessions.state`, geçici veri `chat_sessions.context` (JSONB)
 * kolonunda tutuluyor. Bellekte tutulmuyor: sunucu yeniden başlasa da
 * müşteri konuşmanın ortasında kalmaz, ayrıca birden fazla sunucu örneği
 * çalıştırılabilir.
 */

export const CHAT_STATE = {
  IDLE: 'idle',
  MAIN_MENU: 'main_menu',
  ASK_NAME: 'ask_name',
  SELECT_BARBER: 'select_barber',
  SELECT_DATE: 'select_date',
  ASK_CUSTOM_DATE: 'ask_custom_date',
  SELECT_TIME: 'select_time',
  SELECT_SERVICE: 'select_service',
  CONFIRM: 'confirm',
  SELECT_CANCEL_TARGET: 'select_cancel_target',
  CONFIRM_CANCEL: 'confirm_cancel',
} as const;

export type ChatState = (typeof CHAT_STATE)[keyof typeof CHAT_STATE];

/**
 * Konuşma boyunca biriken seçimler.
 *
 * Alanlar `| undefined` taşıyor: `exactOptionalPropertyTypes` açık olduğu için
 * bir alanı açıkça temizlemek (örn. tarih seçimine geri dönerken
 * `date: undefined`) aksi halde tip hatası verir.
 */
export interface ChatContext {
  barberId?: string | undefined;
  barberName?: string | undefined;
  /** Yerel tarih: "2026-08-12" */
  date?: string | undefined;
  /** ISO 8601 UTC anı */
  startsAt?: string | undefined;
  timeLabel?: string | undefined;
  serviceId?: string | undefined;
  serviceName?: string | undefined;
  /** Saat listesinde sayfalama — Meta liste mesajı en fazla 10 satır alır. */
  timeOffset?: number | undefined;
  /** İptal akışında seçilen randevu. */
  cancelTargetId?: string | undefined;
}

/** Butonlardan dönen kimlikler. Metin yazan müşteri için de eşleşme yapılır. */
export const ACTION = {
  BOOK: 'action_book',
  MY_APPOINTMENTS: 'action_my_appointments',
  CANCEL: 'action_cancel',
  CONFIRM_YES: 'action_confirm_yes',
  CONFIRM_NO: 'action_confirm_no',
  DATE_TODAY: 'date_today',
  DATE_TOMORROW: 'date_tomorrow',
  DATE_OTHER: 'date_other',
  MORE_TIMES: 'more_times',
} as const;

/** Ön ek + kimlik taşıyan buton kimlikleri. */
export const PREFIX = {
  BARBER: 'barber:',
  SLOT: 'slot:',
  SERVICE: 'service:',
  APPOINTMENT: 'appt:',
} as const;

/**
 * Her durumda çalışan komutlar.
 *
 * Müşteri konuşmanın neresinde olursa olsun bunları yazabilmeli — aksi halde
 * yanlış bir seçim yapan kişi akışta sıkışıp kalır.
 */
export const GLOBAL_COMMANDS = {
  MENU: ['menü', 'menu', 'başa dön', 'basa don', 'iptal et', 'vazgeç', 'vazgec'],
  /** Meta politikası gereği zorunlu. */
  OPT_OUT: ['dur', 'stop', 'çıkar', 'cikar', 'abonelikten çık', 'iptal abonelik'],
  GREETING: ['merhaba', 'selam', 'slm', 'iyi günler', 'randevu', 'hey'],
} as const;

/** Türkçe küçük harfe çevirir. `toLowerCase()` I/İ harflerini bozar. */
export function normalizeTurkish(input: string): string {
  return input
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .trim();
}

export function matchesCommand(input: string, commands: readonly string[]): boolean {
  const normalized = normalizeTurkish(input);
  return commands.some((c) => normalized === c);
}

/** Oturum bu kadar hareketsiz kalırsa sıfırlanır. */
export const SESSION_TTL_MIN = 30;

/** Bu kadar anlaşılmayan mesajdan sonra müşteri insana yönlendirilir. */
export const MAX_INVALID_INPUTS = 3;
