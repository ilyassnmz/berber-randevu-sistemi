# 💈 Müslüm Berber — WhatsApp Randevu Sistemi

Müşteriler WhatsApp üzerinden randevu alır, berberler mobil web panelinden yönetir.

Yol haritası ve teknik kararlar için: **[todo.md](todo.md)**

---

## Durum

| Aşama | Durum |
|---|---|
| Sprint 0 — Temel altyapı | ✅ Tamamlandı |
| M1 — Veri modeli | ✅ Tamamlandı |
| M2 — Slot motoru | ✅ Tamamlandı |
| M3 — Backend API | 🟡 Kimlik doğrulama + randevular hazır |
| M4 — Güvenlik | 🟡 Kimlik doğrulama tarafı hazır |
| M5 — WhatsApp | ⚪ Başlanmadı |
| M6 — Chatbot | ⚪ Başlanmadı |
| M7 — Panel (PWA) | ⚪ Başlanmadı |

**Hazır olanlar:** Veri modeli (13 tablo, Neon'da) · çakışma kısıtı · slot motoru · kimlik doğrulama (jeton rotasyonu, hesap kilitleme, rol yetkisi) · randevu API'si (walk-in, iptal, tamamlandı, gelmedi, erteleme, listeleme) · denetim kaydı · sağlık kontrolleri

**Sıradaki:** WhatsApp webhook → chatbot → panel

---

## Gereksinimler

- **Node.js 20+** (kurulu: v22.17.0)
- **Neon** hesabı — ücretsiz PostgreSQL, kurulum gerektirmez

---

## Kurulum

### 1. Bağımlılıklar

```bash
npm install
```

### 2. Veritabanı (Neon)

1. [neon.tech](https://neon.tech) adresinde ücretsiz hesap aç
2. Yeni proje oluştur — bölge olarak **Europe (Frankfurt)** seç (Türkiye'ye en yakın)
3. Proje panelinden **Connection string**'i kopyala

### 3. Ortam değişkenleri

```bash
cp .env.example .env
```

`.env` dosyasını aç ve doldur:

- `DATABASE_URL` ve `DIRECT_DATABASE_URL` → Neon'dan kopyaladığın adres
- `JWT_ACCESS_SECRET` → aşağıdaki komutla üret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

WhatsApp ayarları geliştirme sırasında boş kalabilir — bot devre dışı çalışır, API ve panel normal çalışmaya devam eder.

### 4. Veritabanı şemasını oluştur

```bash
npm run db:migrate:deploy --workspace=@berber/api
npm run db:seed --workspace=@berber/api
```

Seed komutu Müslüm ve Fırat için **rastgele şifreler üretip bir kez ekrana basar** — bir parola yöneticisine kaydet, şifreler geri alınamaz.

> **Yeni migration eklerken dikkat:** Çakışma kısıtı Prisma şemasıyla ifade
> edilemiyor, o yüzden ilk migration dosyasının sonuna elle eklendi
> ([kaynak](apps/api/prisma/sql/appointment-overlap-constraint.sql)).
> `prisma migrate dev` bunu görüp şemayla uyumsuz sanabilir; şüphe duyarsan
> `--create-only` ile üret, SQL'i gözden geçir, sonra uygula.

### 5. Çalıştır

```bash
npm run dev
```

→ http://localhost:3000/healthz

---

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | API'yi geliştirme modunda başlatır (değişiklikte yeniden yükler) |
| `npm test` | Tüm testleri çalıştırır |
| `npm run typecheck` | Tip kontrolü |
| `npm run build` | Üretim derlemesi |
| `npm run db:migrate` | Migration uygular |
| `npm run db:seed` | Başlangıç verisini yükler |
| `npm run db:studio` | Veritabanını tarayıcıda görüntüler |

---

## Proje yapısı

```
apps/api/
  prisma/
    schema.prisma      → Veri modeli (13 tablo)
    seed.ts            → Başlangıç verisi
    sql/               → Prisma'nın ifade edemediği SQL (çakışma kısıtı)
  src/
    config/env.ts      → Ortam doğrulama — eksikse uygulama açılışta ölür
    db/client.ts       → Prisma istemcisi
    lib/
      time.ts          → Saat dilimi hesapları
      errors.ts        → Hata tipleri + veritabanı hata çevirisi
      logger.ts        → Loglama (telefon numaraları maskelenir)
    middleware/        → Hata yakalama, auth, hız sınırı
    routes/            → HTTP uçları
    services/
      slots.ts         → Slot motoru ⭐
packages/shared/
  src/
    constants.ts       → Durum enum'ları
    phone.ts           → Telefon normalleştirme (E.164)
    schemas.ts         → Zod şemaları (API + panel ortak)
```

---

## Bilinmesi gereken üç tasarım kararı

### 1. Çakışan randevu veritabanı seviyesinde imkansız

İki müşteri aynı anda aynı saati seçerse, "önce kontrol et sonra yaz" mantığı yetmez — kontrol ile yazma arasında her zaman bir aralık kalır.

Bunun yerine kural veritabanına öğretildi:

```sql
EXCLUDE USING gist (barber_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('pending_confirm', 'confirmed'))
```

Uygulamanın tek görevi `23P01` hatasını yakalayıp *"bu saat az önce doldu"* demek. Ayrıntı: [`prisma/sql/appointment-overlap-constraint.sql`](apps/api/prisma/sql/appointment-overlap-constraint.sql)

### 2. Randevu süresi (45 dk) hiçbir yere gömülü değil

Süre `services.duration_min`, ızgara adımı `shops.slot_step_min` kolonundan okunur. Slot motoru sabit saat listesi yerine aralık çakışması hesaplar.

Bugün sonuç sabit ızgarayla birebir aynı; ileride *"boyama 90 dakika"* demek tek bir `UPDATE`. Motorun bunu zaten desteklediğini garanti eden testler mevcut.

### 3. Zaman her yerde UTC anı olarak saklanır

Veritabanında `TIMESTAMPTZ`, yerel saat yalnızca gösterimde. Çalışma saatleri (`"09:00"`) dükkanın saat dilimine göre yorumlanır.

Türkiye 2016'dan beri kalıcı UTC+3 ve yaz saati uygulamıyor, ama offset koda gömülmedi — `Intl` üzerinden hesaplanıyor.

---

## Test

### Birim testleri — veritabanı gerektirmez

```bash
npm test
```

58 test. Yoğunlaştıkları yer, hataların yaşayacağı modüller:

- **Slot motoru** (31 test) — çalışma saatleri, izinler, dolu saatler, geçmiş saatler, rezervasyon penceresi, değişken süre
- **Saat dilimi hesapları** (18 test) — UTC dönüşümü, gün sınırları, aralık çakışması
- **Telefon normalleştirme** (9 test) — aynı numaranın 8 farklı yazımı tek forma iner

### Entegrasyon testleri — gerçek veritabanına bağlanır

```bash
npm run test:integration --workspace=@berber/api
```

59 test:

- **Çakışma kısıtı** (7) — birim testi olarak yazılamaz, çünkü kısıt PostgreSQL'in
  içinde yaşıyor. Sahte bir veritabanıyla test etmek tam da sınanmak istenen şeyi
  atlamak olurdu. En önemlisi: aynı slota **eşzamanlı üç rezervasyon** gönderiliyor,
  tam olarak birinin başarılı olduğu doğrulanıyor.
- **Kimlik doğrulama** (22) — jeton rotasyonu, çalınmış jeton tespiti, hesap
  kilitleme, kullanıcı sayımına karşı tek tip hata mesajı
- **Randevu API'si** (30) — yetki sınırları (staff başkasının verisine erişemiyor),
  walk-in, durum geçişleri, erteleme, sayfalama

---

## Notlar

- **OneDrive**: Proje OneDrive klasöründe. `node_modules` senkronize edilirse kurulum yavaşlar ve dosya kilidi hataları çıkabilir. Sorun yaşarsan OneDrive ayarlarından bu klasörü senkronizasyon dışı bırak.
- **Prisma uyarısı**: `package.json#prisma` alanı Prisma 7'de kaldırılacak. Şu an çalışıyor; geçiş sırasında `prisma.config.ts`'e taşınacak.
