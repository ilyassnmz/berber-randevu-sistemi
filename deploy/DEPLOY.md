# Dağıtım Kılavuzu — Hetzner

Sistem **iki ayrı adres** sunuyor, ikisi de aynı sunucudaki tek Caddy'den:

| Adres | Ne? |
|---|---|
| `ozdedehairstudio.com` | Müşteri randevu sitesi (`apps/web`) |
| `panel.ozdedehairstudio.com` | Berber paneli (`apps/panel`) |

> ℹ️ WhatsApp Cloud API **kullanılmıyor**. Randevu alma siteye taşındı;
> WhatsApp tarafı kod gerektirmiyor: ücretsiz WhatsApp Business uygulamasının
> "Karşılama mesajı" özelliği siteye yönlendiriyor.
> Bu kılavuzdaki hiçbir adım Meta hesabına ihtiyaç duymaz.

## Ön koşullar (kullanıcı tarafından hazırlanır)

- [ ] Hetzner'de bir CX22 sunucu (Ubuntu 24.04), IP adresi elde
- [ ] Bir domain satın alındı
- [ ] **İKİ A kaydı** sunucunun IP'sine yönlendirildi:

      Tip: A   Ad: @       Değer: <sunucu IP>     → müşteri sitesi
      Tip: A   Ad: panel   Değer: <sunucu IP>     → berber paneli

      Yayılması birkaç dakika-birkaç saat sürebilir. İkisi de
      `nslookup` ile teyit edilmeli.

      ⚠️ `panel` kaydı OLMADAN dağıtım yapılmamalı: kök adres artık
      müşteri sitesini sunduğu için berberler panele tamamen erişemez
      hale gelir. Ayrıca Caddy o alan adı için sertifika alamaz.

- [ ] Neon veritabanı zaten var (geliştirmede kullanılan aynısı — ayrı bir
      üretim veritabanı gerekmiyor, tek dükkanlı sistemde aynısı kullanılabilir)

## 1. Sunucu sertleştirme

```bash
# Sunucuya ilk girişte (root olarak)
adduser deploy
usermod -aG sudo deploy
# SSH anahtarını yeni kullanıcıya kopyala, sonra:
# /etc/ssh/sshd_config içinde PasswordAuthentication no, PermitRootLogin no
systemctl restart sshd

ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable

apt install -y fail2ban
systemctl enable --now fail2ban
```

## 2. Docker kurulumu

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

## 3. Projeyi sunucuya al

```bash
git clone <repo-url> /opt/ozdede
cd /opt/ozdede
cp deploy/.env.example .env
nano .env   # DOMAIN, PANEL_DOMAIN, DATABASE_URL, JWT_ACCESS_SECRET,
            # CORS_ORIGIN (iki adres de) doldurulur
            # WHATSAPP_* alanları BOŞ BIRAKILIR — Cloud API kullanılmıyor
```

## 4. Ayağa kaldır

Önce Caddy yapılandırmasını doğrula — sözdizimi hatası varsa **iki site
birden** açılmaz:

```bash
docker run --rm -v /opt/ozdede/deploy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -e DOMAIN=ozdedehairstudio.com -e PANEL_DOMAIN=panel.ozdedehairstudio.com \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

⚠️ `docker compose run --rm caddy caddy validate` KULLANMAYIN. Caddyfile
imaja build sırasında kopyalandığı için o komut imajdaki ESKİ dosyayı
doğrular; yeni dosyada hata olsa bile "Valid configuration" der. Yukarıdaki
komut yeni dosyayı temiz bir konteynere bağladığı için gerçekten onu sınar.

Beklenen çıktı: `Valid configuration`. Sorun yoksa:

```bash
docker compose up -d --build
docker compose logs -f caddy   # sertifika alımını izle
```

## 5. Doğrula

Her iki adres de ayrı ayrı kontrol edilmeli:

```bash
# Müşteri sitesi
curl https://ozdedehairstudio.com/readyz               # database: ok
curl https://ozdedehairstudio.com/api/v1/public/shop   # hizmet ve berber listesi
curl https://ozdedehairstudio.com/gizlilik             # KVKK sayfası

# Berber paneli
curl https://panel.ozdedehairstudio.com/readyz
curl -I https://panel.ozdedehairstudio.com/            # 200, text/html
```

Tarayıcıdan:

- `https://ozdedehairstudio.com` → randevu akışı açılmalı, hizmetler listelenmeli
- `https://panel.ozdedehairstudio.com` → giriş ekranı açılmalı, giriş yapılabilmeli

HTTPS sertifikaları Caddy tarafından otomatik alınır — ilk istekte birkaç
saniye gecikme normaldir. **İki alan adı için iki ayrı sertifika alınır**,
`panel` için DNS kaydı yoksa o site sertifikasız kalır ve açılmaz.

⚠️ Berberlerin telefonundaki eski panel kısayolu (PWA) artık müşteri
sitesini açar. Yeni adresten tekrar "Ana ekrana ekle" yapmaları gerekir.

## 6. Yedekleme

```bash
# /opt/ozdede/backup.sh
#!/bin/bash
set -e
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
docker compose exec -T api sh -c 'pg_dump "$DATABASE_URL"' | gzip > "/opt/backups/db-$TIMESTAMP.sql.gz"
# Backblaze B2'ye yükleme (rclone kurulu ise):
# rclone copy "/opt/backups/db-$TIMESTAMP.sql.gz" b2:ozdede-backups/
find /opt/backups -name "*.sql.gz" -mtime +30 -delete
```

Crontab'a ekle: `0 3 * * * /opt/ozdede/backup.sh`

⚠️ **Geri yükleme bir kez gerçekten denenmeli.** Hiç geri yüklenmemiş yedek,
yedek değildir.

## 7. Güncelleme (sonraki değişikliklerde)

⚠️ **`git pull` ÇALIŞMAZ — sunucuda git kurulu değil.** Dosyalar geliştirme
makinesinden `scp` ile gönderilir:

```bash
# Geliştirme makinesinde, repo kökünde
scp -i ~/.ssh/id_ed25519 -r \
    apps/api/src apps/web/src apps/panel/src packages/shared/src \
    deploy docker-compose.yml \
    deploy@SUNUCU_IP:/opt/ozdede/

# Sonra sunucuda
ssh -i ~/.ssh/id_ed25519 deploy@SUNUCU_IP \
    'cd /opt/ozdede && docker compose up -d --build'
```

Yalnızca ön yüz değiştiyse `--build caddy`, yalnızca backend değiştiyse
`--build api` yeterli — tam build birkaç dakika sürüyor.

Veritabanı şeması değiştiyse migration AYRICA uygulanmalı:

```bash
cd apps/api && npx prisma migrate deploy   # geliştirme makinesinden
```

(Neon dışarıdan erişilebilir olduğu için sunucuda çalıştırmaya gerek yok.)

## 8. WhatsApp

Kod tarafında **yapılacak bir şey yok** — Cloud API kullanılmıyor.

Berberin telefonunda WhatsApp Business uygulamasının "Karşılama mesajı"
özelliği açılır ve metne randevu sitesinin adresi yazılır.

`.env` içindeki `WHATSAPP_*` alanları boş kaldığı sürece bot sahte
istemciyle çalışır, hiçbir mesaj göndermez ve hiçbir şeyi bozmaz. İleride
dükkana ayrı bir hat alınırsa bu alanlar doldurulup
`docker compose up -d` demek yeterli (yeniden build gerekmez); webhook
adresi `https://ozdedehairstudio.com/webhook/whatsapp` olarak duruyor.
