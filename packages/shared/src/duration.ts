/**
 * ══════════════════════════════════════════════════════════════════
 *  ÇOKLU HİZMET → RANDEVU SÜRESİ
 * ══════════════════════════════════════════════════════════════════
 *
 * Müşteri bir randevuda birden fazla hizmet seçebiliyor (saç + ağda gibi).
 * Bu durumda süreler TOPLANMAZ: berber ikisini aynı oturumda, aynı 45
 * dakikanın içinde yapıyor. Süreleri toplamak takvimin yarısını boş yere
 * kapatırdı.
 *
 * Ama her hizmet böyle değil. Lazer, yanında başka bir hizmet varken aynı
 * oturuma sığmıyor — kendi zamanını istiyor. Bu yüzden hizmetlerde
 * `requiresOwnSlot` işareti var:
 *
 *   * işaretsiz hizmetler → hepsi tek bir zaman diliminde yapılır,
 *     süreyi aralarındaki EN UZUN olan belirler.
 *   * işaretli hizmetler → kendi süresini randevunun üstüne EKLER.
 *
 * Örnekler (bugünkü dükkanda her hizmet 45 dk, yalnızca Lazer işaretli):
 *
 *   Saç                 → 45          (tek hizmet)
 *   Saç + Ağda          → 45          (ikisi aynı oturumda)
 *   Saç + Sakal + Ağda  → 45
 *   Lazer               → 45          (tek başına; eklenecek bir oturum yok)
 *   Saç + Lazer         → 45 + 45 = 90
 *   Saç + Ağda + Lazer  → 45 + 45 = 90
 *
 * ⚠️ Hiçbir hizmet ADI bu dosyada (ve uygulamanın hiçbir yerinde) geçmiyor.
 * "Lazer" özel değil; `requiresOwnSlot` işaretli olması onu özel yapıyor.
 * Yarın berber "Boyama da ayrı zaman istesin" derse tek bir ayar değişikliği
 * yetiyor — kod aynı kalıyor.
 */

/** Süre hesabı için bir hizmetten gereken tek şey. */
export interface DurationInput {
  durationMin: number;
  requiresOwnSlot: boolean;
}

/** Bir randevuda seçilebilecek en fazla hizmet sayısı. */
export const MAX_SERVICES_PER_APPOINTMENT = 6;

/**
 * Seçilen hizmet kümesinin randevuyu kaç dakika meşgul edeceğini hesaplar.
 *
 * @throws Boş liste verilirse — randevunun en az bir hizmeti olmak zorunda.
 */
export function computeAppointmentDuration(services: readonly DurationInput[]): number {
  if (services.length === 0) {
    throw new Error('Süre hesaplanamaz: en az bir hizmet gerekli');
  }

  const paylasilan = services.filter((s) => !s.requiresOwnSlot);
  const ayriZaman = services.filter((s) => s.requiresOwnSlot);

  // Aynı oturumda yapılan hizmetler arasında en uzunu belirleyici.
  // Hiç yoksa 0 — yalnızca "ayrı zaman isteyen" hizmet(ler) seçilmiş demektir
  // ve o zaman üstüne eklenecek bir oturum yok, kendi süresi randevunun
  // tamamıdır.
  const temel = paylasilan.reduce((enUzun, s) => Math.max(enUzun, s.durationMin), 0);

  return temel + ayriZaman.reduce((toplam, s) => toplam + s.durationMin, 0);
}

/**
 * Randevunun "ana hizmeti" — listelerde ve tek satırlık özetlerde kullanılan.
 *
 * ⚠️ Süreyle İLGİSİ YOK. Süre her zaman kümenin tamamından hesaplanır
 * (`computeAppointmentDuration`); bu fonksiyon yalnızca "randevu tek kelimeyle
 * anlatılacak olsa hangisi yazılır" sorusunu cevaplıyor.
 *
 * Berberin hizmet menüsündeki sıra (`sortOrder`) esas alınıyor: menüde önce
 * gelen hizmet, müşterinin geliş sebebi olma ihtimali en yüksek olandır.
 */
export function pickPrimaryService<T extends { id: string; sortOrder: number }>(
  services: readonly T[],
): T {
  const [primary] = [...services].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  );

  if (!primary) {
    throw new Error('Ana hizmet seçilemez: liste boş');
  }

  return primary;
}

/** "Saç + Ağda" — hizmet adlarını tek satırda gösterir. */
export function formatServiceNames(services: readonly { name: string }[]): string {
  return services.map((s) => s.name).join(' + ');
}

/**
 * Toplam ücret. Fiyatlar TOPLANIR — süreden farklı olarak, iki hizmetin
 * ücreti aynı oturumda yapılsa bile ayrı ayrı alınır.
 *
 * Hiçbir hizmetin fiyatı girilmemişse null döner (arayüz fiyatı gizler);
 * bir kısmı girilmişse girilenlerin toplamı döner.
 */
export function sumServicePrices(services: readonly { price: number | null }[]): number | null {
  const girilenler = services.filter((s) => s.price !== null && s.price !== undefined);
  if (girilenler.length === 0) return null;
  return girilenler.reduce((toplam, s) => toplam + (s.price ?? 0), 0);
}
