# 💈 Özdede Hair Studio — WhatsApp Randevu Sistemi

Müşteriler WhatsApp üzerinden randevu alır, berberler mobil web panelinden yönetir.

Yol haritası ve teknik kararlar için: **[todo.md](todo.md)**

---

## Durum

| Aşama | Durum |
|---|---|
| Sprint 0 — Temel altyapı | ✅ Tamamlandı |
| M1 — Veri modeli | ✅ Tamamlandı |
| M2 — Slot motoru | ✅ Tamamlandı |
| M3 — Backend API | ✅ Tamamlandı |
| M4 — Güvenlik | ✅ Tamamlandı |
| M5 — WhatsApp | ✅ Kod hazır — Meta hesabı bekleniyor |
| M6 — Chatbot | ✅ Tamamlandı |
| M7 — Panel (PWA) | ✅ Tamamlandı |
| M9 — Hatırlatma cron'ları | ✅ Tamamlandı |
| M8 — Gizlilik/KVKK sayfası | ✅ Tamamlandı (`/gizlilik`) |
| Dağıtım (Docker + Caddy) | ✅ Dosyalar hazır — sunucuda henüz test edilmedi |
| Üretime alma (Hetzner + domain) | ⚪ Sunucu/domain bekleniyor |
| WhatsApp gerçek numara bağlantısı | ⚪ **Bilinçli olarak en son** — önce yukarıdakiler doğrulanacak |

**Hazır olanlar:** Veri modeli (14 tablo, Neon'da) · çakışma kısıtı · slot motoru · kimlik doğrulama · randevu API'si (walk-in dahil) · WhatsApp webhook (imza doğrulaması + idempotency) · chatbot (randevu alma, iptal, listeleme) · yönetim paneli (PWA — giriş, günlük takvim, walk-in, randevu detayı, kara liste) · hatırlatma cron'ları · gizlilik politikası sayfası · dağıtım dosyaları (Dockerfile, docker-compose, Caddyfile)

**Sıradaki:** Hetzner sunucusu + domain kurulup her şey WhatsApp'sız doğrulanacak, WhatsApp bağlantısı en son adım olacak. Ayrıntı: [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

> ⚠️ **Docker dosyaları yerel makinede test edilemedi** — bu makinede Docker kurulu değil.
> Dosyalar dikkatle yazıldı ve mantığı elle doğrulandı, ama gerçek `docker build`
> ilk kez sunucuda çalıştırılacak. Bu, dağıtım adımının kendisinin bir parçası —
> sunucu kurulurken build loglarını birlikte izleyip çıkabilecek hataları
> orada düzelteceğiz.

**Kapsam dışı bırakılanlar (v1.1/v1.2'ye ertelendi):** push bildirim, ayarlar ekranı (çalışma saatleri/izin/hizmet yönetimi paneli — şu an yalnızca DB'den), müşteri geçmişi ekranı, istatistikler. Ayrıntı için [todo.md](todo.md).

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

İki ayrı terminalde:

```bash
npm run dev --workspace=@berber/api      # → http://localhost:3000/healthz
```

```bash
npm run dev --workspace=@berber/panel    # → http://localhost:5173
```

Panel, `/api` isteklerini geliştirme sırasında otomatik olarak API'ye yönlendirir (bkz. `apps/panel/vite.config.ts`). Seed adımında verilen e-posta/şifre ile giriş yapılabilir.

---

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev --workspace=@berber/api` | API'yi geliştirme modunda başlatır (değişiklikte yeniden yükler) + zamanlanmış işleri çalıştırır |
| `npm run dev --workspace=@berber/panel` | Paneli geliştirme modunda başlatır |
| `npm test` | Birim testlerini çalıştırır (tüm workspace'ler) |
| `npm run test:integration --workspace=@berber/api` | Gerçek veritabanına karşı entegrasyon testleri |
| `npm run typecheck` | Tip kontrolü (tüm workspace'ler) |
| `npm run build` | Üretim derlemesi (tüm workspace'ler) |
| `npm run db:migrate` | Migration uygular (geliştirme) |
| `npm run db:migrate:deploy --workspace=@berber/api` | Migration uygular (üretim) |
| `npm run db:seed --workspace=@berber/api` | Başlangıç verisini yükler |
| `npm run db:studio --workspace=@berber/api` | Veritabanını tarayıcıda görüntüler |
| `npm run whatsapp:templates --workspace=@berber/api` | Meta'ya girilecek şablon metinlerini yazdırır |

---

## Proje yapısı

```
apps/api/
  prisma/
    schema.prisma      → Veri modeli (14 tablo)
    seed.ts            → Başlangıç verisi
    sql/               → Prisma'nın ifade edemediği SQL (çakışma kısıtı)
  src/
    config/env.ts      → Ortam doğrulama — eksikse uygulama açılışta ölür
    db/client.ts       → Prisma istemcisi
    jobs/
      lock.ts          → Satır tabanlı iş kilidi (job_locks tablosu)
      reminders.ts     → 1 gün / 1 saat önce hatırlatma
      cleanup.ts       → Süresi dolmuş kayıt temizliği
      scheduler.ts     → node-cron zamanlaması
    lib/
      time.ts          → Saat dilimi hesapları
      errors.ts        → Hata tipleri + veritabanı hata çevirisi
      logger.ts        → Loglama (telefon numaraları maskelenir)
    middleware/        → Hata yakalama, auth, hız sınırı
    routes/            → HTTP uçları
    services/
      slots.ts         → Slot motoru ⭐
      whatsapp/        → Meta istemcisi + sahte istemci + imza doğrulama
      chatbot/         → Durum makinesi
apps/panel/
  src/
    lib/
      api.ts           → fetch sarmalayıcı — jeton yenileme, 401 yönetimi
      authStore.ts      → Oturum durumu (jeton BELLEKTE, localStorage'da değil)
    pages/              → LoginPage, CalendarPage
    components/         → AppointmentCard, WalkInModal, AppointmentDetailModal...
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

### 4. Cron kilitleri Postgres advisory lock DEĞİL, satır tabanlı

Plan başlangıçta `pg_try_advisory_lock` öngörüyordu. Uygulama sırasında Neon'un
havuzlanmış bağlantısına (PgBouncer, transaction modu) karşı ölçüldüğünde, iki
eşzamanlı çağrının **ikisinin de** kilidi alabildiği görüldü — advisory lock'lar
oturum sürekliliğine dayanıyor ve havuzlama bunu bozabiliyor.

Çözüm `job_locks` tablosuna atomik `INSERT ... ON CONFLICT ... WHERE locked_until
< now()`: sıradan bir DML işlemi olduğu için bağlantı havuzlamasından etkilenmiyor.
Bkz. [`src/jobs/lock.ts`](apps/api/src/jobs/lock.ts).

### 5. Panel'de erişim jetonu `localStorage`'da değil, bellekte

Sayfa yenilenince kaybolur; `apps/panel/src/routes/ProtectedRoute.tsx` açılışta
httpOnly çerezle sessizce yeni jeton alır. `localStorage`'a yazılan bir jeton,
siteye sızan herhangi bir betikle (XSS) okunabilir olurdu.

---

## Test

### Birim testleri — veritabanı gerektirmez

```bash
npm test
```

71 test. Yoğunlaştıkları yer, hataların yaşayacağı modüller:

- **Slot motoru** (31 test) — çalışma saatleri, izinler, dolu saatler, geçmiş saatler, rezervasyon penceresi, değişken süre
- **Saat dilimi hesapları** (18 test) — UTC dönüşümü, gün sınırları, aralık çakışması
- **Telefon normalleştirme** (9 test) — aynı numaranın 8 farklı yazımı tek forma iner
- **Webhook imza doğrulaması** (13 test) — geçersiz/eksik imza, gövde değişikliği tespiti

### Entegrasyon testleri — gerçek veritabanına bağlanır

```bash
npm run test:integration --workspace=@berber/api
```

99 test:

- **Çakışma kısıtı** (7) — birim testi olarak yazılamaz, çünkü kısıt PostgreSQL'in
  içinde yaşıyor. Sahte bir veritabanıyla test etmek tam da sınanmak istenen şeyi
  atlamak olurdu. En önemlisi: aynı slota **eşzamanlı üç rezervasyon** gönderiliyor,
  tam olarak birinin başarılı olduğu doğrulanıyor.
- **Kimlik doğrulama** (22) — jeton rotasyonu, çalınmış jeton tespiti, hesap
  kilitleme, kullanıcı sayımına karşı tek tip hata mesajı
- **Randevu API'si** (30) — yetki sınırları (staff başkasının verisine erişemiyor),
  walk-in, durum geçişleri, erteleme, sayfalama
- **Chatbot** (27) — sahte WhatsApp istemcisiyle uçtan uca konuşma simülasyonu:
  randevu alma, iptal, kara liste, opt-out, hatalı girdi yönetimi
- **Cron işleri** (13) — kilit eşzamanlılığı, hatırlatma pencereleri, opt-out
  müşteriye göndermeme

Panel, tarayıcıda gerçek giriş bilgileriyle uçtan uca elle test edildi (giriş,
oturum kalıcılığı, staff/admin yetki ayrımı, walk-in oluşturma, durum
değişiklikleri, iptal akışı) — ayrı bir otomatik tarayıcı test takımı yok.

---

## WhatsApp — Meta hesabı olmadan geliştirme

Bot numarası hazır olmadan da chatbot'un tamamı çalışıyor ve test ediliyor.

`.env` içindeki `WHATSAPP_*` alanları boşsa uygulama **sahte istemciye** düşer:
mesajlar hiçbir yere gönderilmez, konsola yazılır ve bellekte tutulur. Chatbot
akışının 27 testi bu istemci üzerinden koşuyor.

Gerçek numara geldiğinde yapılacaklar:

1. `npm run whatsapp:templates --workspace=@berber/api` → çıktıyı Meta paneline gir
   (şablon onayı 1-3 gün sürer, onaysız hatırlatma gönderilemez)
2. `.env` içine `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` gir
3. Meta panelinde webhook adresi: `https://<alan-adı>/webhook/whatsapp`

Kodda hiçbir değişiklik gerekmiyor — istemci seçimi yapılandırmadan geliyor.

> ℹ️ Doğrulanmamış Meta hesabı 24 saatte 250 benzersiz müşteriye mesaj
> gönderebilir. Bir berber için fazlasıyla yeterli; lansman Business
> Verification'ı beklemek zorunda değil.

> ⚠️ **Bu alanlar `NODE_ENV=production`'da da opsiyoneldir** — bilinçli bir
> tasarım kararı. Zorunlu tutulsaydı, Meta hesabı hazır olmadan üretim
> sunucusu hiç açılamazdı. Yol haritası önce sunucunun WhatsApp'sız
> doğrulanmasını, sonra WhatsApp'ın bağlanmasını öngörüyor.

---

## Dağıtım (Hetzner)

Docker Compose ile tek komutla ayağa kalkacak şekilde hazırlandı:
`api` konteyneri (Node.js) + `caddy` konteyneri (panel'in statik dosyalarını
servis eder, API'yi ters proxy'ler, HTTPS sertifikasını otomatik alır).
Veritabanı ayrı bir konteyner değil — geliştirmede kullanılan Neon.

Adım adım kurulum: **[`deploy/DEPLOY.md`](deploy/DEPLOY.md)**

```
deploy/
  Dockerfile.api      → API imajı
  Dockerfile.caddy     → Panel derlemesi + Caddy
  Caddyfile             → Ters proxy + statik dosya kuralları
  .env.example          → Üretim ortam değişkeni şablonu
  DEPLOY.md              → Adım adım kurulum
docker-compose.yml      → İkisini birlikte ayağa kaldırır
```

> ⚠️ Bu makinede Docker kurulu olmadığı için `docker build` yerel olarak
> denenemedi. Dosyalar dikkatle yazıldı, ama ilk gerçek testleri sunucu
> kurulumu sırasında yapılacak.

---

## Notlar

- **Konum**: Proje bilerek OneDrive **dışında** (`C:\Projeler\Berber`). OneDrive
  içindeyken `node_modules` senkronizasyonu Prisma'nın dosya değiştirmesini
  engelliyor ve `EPERM` hataları çıkıyordu.
- **Prisma uyarısı**: `package.json#prisma` alanı Prisma 7'de kaldırılacak. Şu an
  çalışıyor; geçiş sırasında `prisma.config.ts`'e taşınacak.
