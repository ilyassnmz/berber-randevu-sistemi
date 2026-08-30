# 💈 Özdede Hair Studio — Online Randevu Sistemi

Bir berber dükkanı için yazılmış, üretimde çalışan randevu sistemi.
Müşteriler internet sitesinden randevu alır; berberler mobil öncelikli bir
panelden günlerini yönetir.

| Adres | Ne | Uygulama |
|---|---|---|
| `ozdedehairstudio.com` | Müşteri randevu sitesi | `apps/web` |
| `panel.ozdedehairstudio.com` | Berber paneli (PWA) | `apps/panel` |

**Yığın:** TypeScript · Node.js + Express · PostgreSQL (Prisma) · React + Vite ·
Docker Compose + Caddy

---

## İçindekiler

- [Ne yapar](#ne-yapar)
- [Mimari](#mimari)
- [Dikkate değer tasarım kararları](#dikkate-değer-tasarım-kararları)
- [Kurulum](#kurulum)
- [Komutlar](#komutlar)
- [Proje yapısı](#proje-yapısı)
- [Test](#test)
- [Dağıtım](#dağıtım)

---

## Ne yapar

**Müşteri tarafı** — giriş yok, dört adım: hizmet → berber → gün/saat → bilgiler.

- **Çoklu hizmet seçimi.** "Saç + Ağda" tek randevuda alınabilir. Süreler
  toplanmaz: ikisi aynı oturumda yapılıyor. İstisna, "ayrı zaman ister"
  işaretli hizmetler — yanlarında başka hizmet varken randevuyu bir oturum
  uzatırlar. Kural hizmet adına değil veritabanındaki işarete bakar.
- Randevu, tahmin edilemez bir bağlantıyla görüntülenip iptal edilebilir.
- Kapalı günler tarih şeridinde baştan soluk gösterilir; "saat kalmadı"
  mesajı yalnızca gerçekten dolu günler için çıkar (kapalı / izinli / dolu
  ayrı ayrı anlatılır).

**Berber tarafı** — telefona kurulabilen bir PWA.

- Günlük akış: randevular ve boş saatler tek listede, geçmiş saatler dahil.
- Kapıdan gelen müşteri için tek dokunuşla randevu, saat değiştirme, iptal,
  "geldi/gelmedi" işaretleme.
- Çalışma saatleri, izin günleri, hizmet süresi/fiyatı ve yeni berber ekleme
  panelden yönetilir.
- Müşteri listesi, randevu geçmişi, kara liste ve dönemsel istatistikler.
- Yeni randevu geldiğinde telefona web push bildirimi.

**Kötüye kullanıma karşı** — sistem herkese açık ve telefon doğrulaması yok:

- Bir numara, güne yalnızca bir randevu alabilir.
- Aynı cihazdan günde en fazla üç *farklı* numaraya randevu alınabilir. Cihaz,
  IP'nin HMAC özetiyle tanınır — ham IP hiç saklanmaz.
- Saldırı hâlinde berber, aynı cihazdan gelen tüm randevuları tek işlemle
  iptal edebilir.
- Randevu yazma ucunda ayrı ve dar bir hız sınırı var (mobil operatörlerin
  CGNAT'ı yüzünden bilerek gevşek tutuldu — aynı IP'nin arkasında gerçek
  müşteriler var).

---

## Mimari

```
                    ┌──────────────┐
   müşteri  ───────▶│  apps/web    │──┐
                    └──────────────┘  │   /api/v1/public   ┌──────────────┐
                                      ├───────────────────▶│   apps/api   │──▶ PostgreSQL
                    ┌──────────────┐  │   /api/v1/*        │   (Express)  │
   berber   ───────▶│  apps/panel  │──┘   (kimlik doğrulamalı)└──────────────┘
                    └──────────────┘
                                          packages/shared
                                    (zod şemaları, iş kuralları)
```

npm workspaces ile tek depo. `packages/shared` yalnızca tip paylaşımı için
değil: telefon normalleştirme, randevu süresi hesabı ve doğrulama şemaları
burada yaşıyor ve **hem sunucu hem iki arayüz aynı fonksiyonu çağırıyor.**
Ekranda yazan süre ile takvimde ayrılan sürenin ayrışması böylece mümkün değil.

Herkese açık uçlar (`/api/v1/public`) ayrı bir router'da ve ayrı bir servis
katmanından geçiyor. Sebebi mimari: panel uçlarında `req.auth` her sınırı
kendiliğinden çiziyor (hangi dükkan, hangi berber), herkese açık tarafta böyle
bir sınır yok — dolayısıyla her sınır elle çizilmek zorunda. Dükkan kimliği
istemciden hiç alınmıyor, sunucuda çözülüyor.

---

## Dikkate değer tasarım kararları

### Çakışan randevu veritabanı seviyesinde imkânsız

İki müşteri aynı anda aynı saati seçerse "önce kontrol et sonra yaz" yetmez;
kontrol ile yazma arasında her zaman bir aralık kalır. Kural bu yüzden
veritabanına öğretildi:

```sql
EXCLUDE USING gist (barber_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('pending_confirm', 'confirmed'))
```

Uygulamanın tek görevi `23P01` hatasını yakalayıp *"bu saat az önce doldu"*
demek. Uygulama içindeki müsaitlik kontrolü yarışa karşı değil, kullanıcıya
anlamlı mesaj vermek için. → [`appointment-overlap-constraint.sql`](apps/api/prisma/sql/appointment-overlap-constraint.sql)

### Randevu süresi hiçbir yere gömülü değil

45 dakika sayısı kodun hiçbir yerinde geçmez. Süre `services.duration_min`,
ızgara adımı `shops.slot_step_min` kolonundan okunur; slot motoru sabit saat
listesi yerine aralık çakışması hesaplar.

Çoklu hizmet geldiğinde bu kararın karşılığı alındı: "Saç + Lazer 90 dakika"
demek için motorda tek satır değişmedi. → [`slots.ts`](apps/api/src/services/slots.ts) · [`duration.ts`](packages/shared/src/duration.ts)

Slot motoru bilerek **saf bir fonksiyon**: veritabanına hiç dokunmuyor, veriyi
parametre olarak alıyor. Hataların yaşayacağı modül böylece veritabanı olmadan
tam olarak test edilebiliyor.

### Zaman her yerde UTC anı

Veritabanında `TIMESTAMPTZ`; yerel saat yalnızca gösterimde. `DATE + TIME` ayrı
kolonlar kullanılsaydı yukarıdaki çakışma kısıtı yazılamazdı. Türkiye 2016'dan
beri kalıcı UTC+3 ama offset koda gömülmedi — `Intl` üzerinden hesaplanıyor.

### Cron kilitleri advisory lock değil, satır tabanlı

Başlangıçta `pg_try_advisory_lock` düşünülmüştü. Havuzlanmış bağlantıya
(PgBouncer, transaction modu) karşı ölçüldüğünde **iki eşzamanlı çağrının
ikisinin de** kilidi alabildiği görüldü: advisory lock'lar oturum sürekliliğine
dayanıyor, havuzlama bunu bozuyor.

Çözüm, `job_locks` tablosuna atomik `INSERT ... ON CONFLICT`. Sıradan bir DML
işlemi olduğu için havuzlamadan etkilenmiyor. → [`lock.ts`](apps/api/src/jobs/lock.ts)

### Panelde erişim jetonu bellekte, `localStorage`'da değil

Sayfa yenilenince kaybolur; açılışta httpOnly çerezle sessizce yenisi alınır.
`localStorage`'a yazılan bir jeton, siteye sızacak herhangi bir betikle (XSS)
okunabilir olurdu. Yenileme jetonları da veritabanında ham değil, SHA-256
özetiyle tutuluyor ve her kullanımda döndürülüyor.

### Hiçbir şey silinmez

Randevu iptal edilince durumu değişir, satır kalır; berber pasife alınır;
randevusu olan hizmet silinmez, gizlenir. Geçmiş takvim, gelmedi sayacı ve
denetim kaydı ancak böyle tutarlı kalıyor.

---

## Kurulum

Gereken: **Node.js 20+** ve bir **PostgreSQL** veritabanı (proje
[Neon](https://neon.tech) ile geliştirildi — ücretsiz katman yeterli).

```bash
npm install
cp .env.example apps/api/.env
```

`apps/api/.env` içinde doldurulması gerekenler:

| Değişken | Ne |
|---|---|
| `DATABASE_URL` · `DIRECT_DATABASE_URL` | Postgres bağlantı adresi |
| `JWT_ACCESS_SECRET` | En az 32 karakter rastgele değer |
| `PUBLIC_SHOP_ID` | Sitenin ait olduğu dükkanın kimliği (seed sonrası) |

Rastgele anahtar üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Şemayı kurup başlangıç verisini yükleyin:

```bash
npm run db:migrate:deploy --workspace=@berber/api
npm run db:seed --workspace=@berber/api
```

> Seed, berber hesapları için **rastgele şifre üretip bir kez ekrana basar.**
> Şifreler geri alınamaz; bir parola yöneticisine kaydedin.

Çalıştırın (ayrı terminallerde):

```bash
npm run dev --workspace=@berber/api      # http://localhost:3000/healthz
npm run dev --workspace=@berber/panel    # http://localhost:5173
npm run dev --workspace=@berber/web      # http://localhost:5174
```

Her iki arayüz de `/api` isteklerini geliştirme sırasında otomatik olarak
API'ye yönlendirir.

### İsteğe bağlı yapılandırma

Hiçbiri zorunlu değil; eksikse ilgili özellik **sessizce devre dışı kalır,
uygulama normal çalışır.**

| Değişken | Ne olur |
|---|---|
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` | Berbere yeni randevu bildirimi |
| `SENTRY_DSN` | Hata izleme (telefon/şifre/jeton ayıklanır) |
| `WHATSAPP_*` | Uykudaki WhatsApp chatbot'u etkinleşir |

> **Şema değişikliği eklerken:** Çakışma kısıtı Prisma şemasıyla ifade
> edilemiyor, bu yüzden ilk migration dosyasının sonuna elle eklendi. `prisma
> migrate dev` bunu şemayla uyumsuz sanabilir; `--create-only` ile üretip SQL'i
> gözden geçirdikten sonra uygulayın.

---

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev --workspace=@berber/api` | API + zamanlanmış işler |
| `npm run dev --workspace=@berber/panel` | Berber paneli |
| `npm run dev --workspace=@berber/web` | Müşteri sitesi |
| `npm test` | Birim testleri (veritabanı gerekmez) |
| `npm run test:integration --workspace=@berber/api` | Entegrasyon testleri |
| `npm run typecheck` | Tip kontrolü |
| `npm run build` | Üretim derlemesi |
| `npm run db:studio --workspace=@berber/api` | Veritabanını tarayıcıda aç |

---

## Proje yapısı

```
apps/api/                 Express + Prisma
  prisma/
    schema.prisma         Veri modeli (16 tablo)
    sql/                  Prisma'nın ifade edemediği SQL (çakışma kısıtı)
  src/
    config/env.ts         Ortam doğrulaması — eksikse uygulama açılışta ölür
    jobs/                 Cron: hatırlatmalar, temizlik, satır tabanlı kilit
    lib/                  Saat dilimi, hata çevirisi, loglama (telefon maskeli)
    middleware/           Kimlik doğrulama + yetki, merkezi hata yakalama
    routes/               HTTP uçları (public/ ayrı ve kimlik doğrulamasız)
    services/
      slots.ts            Slot motoru — saf fonksiyon ⭐
      appointments.ts     Randevu iş mantığı
      public-booking.ts   Herkese açık randevu akışı
      auth.ts             Giriş, jeton rotasyonu, hesap kilitleme
      whatsapp/           Meta istemcisi + sahte istemci + imza doğrulama
      chatbot/            Durum makinesi (uykuda)
apps/panel/               Berber paneli (React, PWA)
apps/web/                 Müşteri randevu sitesi (React)
packages/shared/          Zod şemaları, telefon normalleştirme, süre hesabı
deploy/                   Dockerfile'lar, Caddyfile, dağıtım kılavuzu
```

---

## Test

**Birim testleri** — veritabanı gerektirmez, saniyeler sürer:

```bash
npm test
```

84 test. Yoğunlaştıkları yer hataların yaşayacağı modüller: slot motoru (31),
saat dilimi hesapları (18), webhook imza doğrulaması (13), çoklu hizmet süre
kuralı (12), telefon normalleştirme (9).

**Entegrasyon testleri** — gerçek veritabanına bağlanır:

```bash
npm run test:integration --workspace=@berber/api
```

219 test. Öne çıkanlar:

- **Çakışma kısıtı** — birim testi olarak yazılamaz, çünkü kısıt PostgreSQL'in
  içinde yaşıyor; sahte bir veritabanıyla test etmek tam da sınanmak isteneni
  atlamak olurdu. Aynı slota **eşzamanlı üç rezervasyon** gönderilip tam olarak
  birinin başarılı olduğu doğrulanıyor.
- **Yetki sınırları** — `staff` rolündeki berberin, istemciden ne gönderirse
  göndersin başkasının verisine erişemediği.
- **Herkese açık uçlar** — başka dükkanın kimliğinin sızdırılamaması, müşteri
  telefonunun yanıtlarda dönmemesi, kuralların atlanamaması.
- **Kimlik doğrulama** — jeton rotasyonu, çalınmış jeton tespiti, hesap
  kilitleme, kullanıcı sayımına karşı tek tip hata mesajı.

> ⚠️ Entegrasyon testleri `TEST_DATABASE_URL` tanımlı değilse ya da bu değer
> üretim veritabanını gösteriyorsa **çalışmayı reddeder.** Bu koruma sonradan
> eklendi: testler bir dönem üretimle aynı veritabanına yazdı ve yarıda kalan
> bir koşudan artakalan kayıt canlı siteyi düşürdü.

---

## Dağıtım

Docker Compose ile iki konteyner: `api` (Node.js) ve `caddy` (iki sitenin
statik dosyalarını sunar, API'yi ters proxy'ler, HTTPS sertifikasını otomatik
alır). Veritabanı konteyner değil, yönetilen bir servis.

```bash
docker compose up -d --build
```

Adım adım kurulum, yedekleme ve geri yükleme: **[`deploy/DEPLOY.md`](deploy/DEPLOY.md)**

> Caddyfile imaja build sırasında kopyalanıyor. Değiştiğinde `--build` şart;
> konteyneri yeniden başlatmak yetmez.
