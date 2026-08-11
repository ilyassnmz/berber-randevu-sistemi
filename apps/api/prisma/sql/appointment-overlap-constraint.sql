-- ════════════════════════════════════════════════════════════════════════
--  ÇAKIŞMA KISITI — Sistemin en kritik tek parçası
-- ════════════════════════════════════════════════════════════════════════
--
--  Bu SQL, ilk migration dosyasının (prisma/migrations/*_init/migration.sql)
--  SONUNA eklenir. Kurulum adımları README.md → "Veritabanı kurulumu"nda.
--
--  ── Neden gerekli? ──────────────────────────────────────────────────────
--
--  İki müşteri aynı anda "09:00" seçtiğinde uygulama şunu yapar:
--
--      1. "Bu saat boş mu?"  → Postgres: "boş"
--      2. INSERT
--
--  İki istek aynı anda gelirse İKİSİ de 1. adımda "boş" cevabını alır ve
--  ikisi de INSERT eder. Berber saat 09:00'da iki müşteriyle karşılaşır.
--
--  Bu, uygulama kodunda kontrol ekleyerek çözülemez — kontrol ile yazma
--  arasında her zaman bir aralık kalır. Çözüm, kuralı veritabanının kendisine
--  öğretmektir: aşağıdaki kısıt çakışan iki randevuyu FİZİKSEL OLARAK kabul
--  etmez. Uygulama hata yapsa bile olamaz.
--
--  Uygulamanın tek görevi, ikinci INSERT'in aldığı 23P01 (exclusion_violation)
--  hatasını yakalayıp müşteriye "bu saat az önce doldu" demektir.
--  Bkz. src/lib/errors.ts → isOverlapViolation()
--
--  ── Neden sadece pending_confirm ve confirmed? ──────────────────────────
--
--  İptal edilmiş, tamamlanmış veya gelinmemiş randevular slotu tutmaz;
--  o saate yeni randevu alınabilmeli. Bu liste kodda BLOCKING_STATUSES ile
--  aynı olmak zorunda (packages/shared/src/constants.ts) — biri değişirse
--  diğeri de değişmeli.

-- GiST indeksinin UUID eşitliği (barber_id WITH =) ile aralık çakışmasını
-- (&&) aynı indekste birleştirebilmesi için gerekli.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "barber_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('pending_confirm', 'confirmed'));

--  '[)' aralık tipi: başlangıç dahil, bitiş hariç.
--  09:00–09:45 ile 09:45–10:30 randevuları BİTİŞİK sayılır, çakışmaz.
--  Bu olmadan her randevu bir sonrakini bloke ederdi.

COMMENT ON CONSTRAINT "appointments_no_overlap" ON "appointments" IS
  'Aynı berbere çakışan randevu girilmesini engeller. Uygulama 23P01 hatasını yakalar.';
