# Dağıtım Kılavuzu — Hetzner

Bu doküman, sunucu ve domain hazır olduğunda izlenecek adımları anlatır.
**Sıra önemli**: WhatsApp bağlantısı en son yapılır — buradaki hiçbir adım
Meta hesabına ihtiyaç duymaz.

## Ön koşullar (kullanıcı tarafından hazırlanır)

- [ ] Hetzner'de bir CX22 sunucu (Ubuntu 24.04), IP adresi elde
- [ ] Bir domain satın alındı
- [ ] Domain'in DNS ayarlarında **A kaydı** → sunucunun IP'sine yönlendirildi
      (yayılması birkaç dakika-birkaç saat sürebilir; `nslookup domain.com`
      ile IP'nin doğru döndüğü teyit edilir)
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
nano .env   # DOMAIN, DATABASE_URL, JWT_ACCESS_SECRET doldurulur
            # WHATSAPP_* alanları BOŞ BIRAKILIR
```

## 4. Ayağa kaldır

```bash
docker compose up -d --build
docker compose logs -f api   # açılış loglarını izle
```

## 5. Doğrula

```bash
curl https://<domain>/healthz   # {"status":"ok",...}
curl https://<domain>/readyz    # {"status":"ok","checks":{"database":"ok"}}
curl https://<domain>/gizlilik  # gizlilik politikası HTML'i
```

Tarayıcıdan `https://<domain>` açılıp panelin yüklendiği, giriş yapılabildiği
kontrol edilir. HTTPS sertifikası Caddy tarafından otomatik alınır — ilk
istekte birkaç saniye gecikme normaldir.

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

```bash
cd /opt/ozdede
git pull
docker compose up -d --build
```

## 8. WhatsApp bağlantısı — EN SON ADIM

Yukarıdaki her şey çalışır durumdayken, ve yalnızca o zaman:

1. Meta hesabı ve şablonlar hazırlanır (bkz. ana `README.md`)
2. `.env` dosyasına 4 WhatsApp değişkeni girilir
3. `docker compose up -d` (yeniden build gerekmez, sadece yeniden başlatma)
4. Meta panelinde webhook adresi: `https://<domain>/webhook/whatsapp`
