/**
 * Müşterinin kendi randevularını hatırlama.
 *
 * ── Neden telefon numarasıyla sorgulama YOK? ──────────────────────
 *
 * "Randevularımı göster" için telefon numarası soran bir ekran, isteyen
 * herkesin rastgele numaralar deneyerek başkalarının randevularını (kimin,
 * ne zaman, hangi berberde) görmesine izin verirdi. Kimlik doğrulaması
 * olmayan bir sitede bunu güvenli yapmanın yolu SMS doğrulaması, o da bu
 * proje için fazla ağır.
 *
 * Bunun yerine randevu anahtarları YALNIZCA tarayıcıda saklanıyor. Sonuç:
 * müşteri kendi telefonundan girdiğinde randevusunu görür; başka birinin
 * randevusuna hiçbir koşulda erişemez.
 *
 * Bedeli: müşteri telefonunu değiştirir ya da tarayıcı verisini silerse
 * bağlantıyı kaybeder. Bu durumda berberi araması gerekir — kabul edilebilir,
 * çünkü alternatifi herkesin verisini herkese açmak.
 */

const STORAGE_KEY = 'ozdede-randevu-anahtarlari';
const MAX_STORED = 10;

/** Depolanan anahtarlar, en yeniden eskiye. */
export function getStoredTokens(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    // Gizli sekme, dolu depolama ya da bozuk veri — randevu almayı
    // engellemesine izin verilmez.
    return [];
  }
}

export function storeToken(token: string): void {
  try {
    const existing = getStoredTokens().filter((t) => t !== token);
    const updated = [token, ...existing].slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Saklanamadıysa randevu yine de geçerli; müşteri ekrandaki bağlantıyı
    // kullanabilir. Sessizce geçiyoruz.
  }
}

export function forgetToken(token: string): void {
  try {
    const remaining = getStoredTokens().filter((t) => t !== token);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // yoksay
  }
}
