#!/bin/bash
#
# Günlük veritabanı yedeği.
#
# Crontab'a şu satırla bağlanır (her gece 03:00):
#     0 3 * * * /opt/ozdede/backup.sh >> /var/log/ozdede-backup.log 2>&1
#
# ── Neden bu kadar basit? ────────────────────────────────────────
# Yedek betiği, en kötü günde çalışması gereken şeydir. Karmaşık bir betik,
# tam ihtiyaç duyulduğunda kendi hatasıyla patlar. Burada tek iş var:
# veritabanını dök, sıkıştır, eskiyi sil.
#
# ⚠️ Bu yedek SUNUCUNUN KENDİ DİSKİNDE. Hatalı sorgu ve yazılım hatalarına
# karşı korur; sunucunun tamamen kaybolmasına karşı KORUMAZ. Onun için
# dışarı (Backblaze/S3) kopyalamak gerekir — aşağıdaki rclone satırı bunun
# içindir, hesap açıldığında yorumdan çıkarılır.

set -euo pipefail

YEDEK_DIZINI="/opt/backups"
SAKLAMA_GUNU=30
DAMGA=$(date +%Y%m%d-%H%M%S)
HEDEF="$YEDEK_DIZINI/ozdede-$DAMGA.sql.gz"

mkdir -p "$YEDEK_DIZINI"

# Betik yarıda kalırsa yarım dosya BIRAKMA.
#
# Bu olmadan başarısız her deneme, dizinde küçük bozuk bir .gz bırakıyordu.
# Sonuç en tehlikeli hâl: klasör yedek dolu görünüyor ama içindekiler
# geri yüklenemiyor. Yedek ya tam olmalı ya hiç olmamalı.
trap '[ -n "${HEDEF:-}" ] && [ ! -s "$HEDEF" ] && rm -f "$HEDEF"' ERR

# DATABASE_URL'i .env'den al. Konteynerden değil doğrudan okuyoruz:
# yedek, uygulama çökmüş olsa bile alınabilmeli.
set -a
# shellcheck disable=SC1091
source /opt/ozdede/.env
set +a

# Migration'lar için kullanılan doğrudan bağlantı tercih edilir; havuzlanmış
# bağlantı (PgBouncer) pg_dump ile sorun çıkarabiliyor.
DUMP_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"

echo "[$(date -Is)] Yedek başlıyor -> $HEDEF"

# pg_dump sunucuda kurulu olmayabilir; postgres imajını tek seferlik kullanıyoruz.
#
# ⚠️ İmaj sürümü SUNUCUNUNKİNDEN ESKİ OLAMAZ. pg_dump kendisinden yeni bir
# sunucuyu dökmeyi reddediyor ("server version mismatch"). Neon yükseltirse
# bu satır da yükseltilmeli, yoksa yedek sessizce alınamaz olur.
docker run --rm postgres:18-alpine \
  pg_dump --no-owner --no-privileges "$DUMP_URL" | gzip > "$HEDEF"

BOYUT=$(stat -c%s "$HEDEF")

# Boş/bozuk yedek sessizce birikmesin: 1 KB'den küçükse bir şeyler yanlıştır.
if [ "$BOYUT" -lt 1024 ]; then
  echo "[$(date -Is)] HATA: yedek çok küçük ($BOYUT bayt) — siliniyor"
  rm -f "$HEDEF"
  exit 1
fi

echo "[$(date -Is)] Yedek tamam: $BOYUT bayt"

# Dışarı kopyalama (hesap açıldığında aç):
# rclone copy "$HEDEF" b2:ozdede-yedekler/

# 30 günden eskileri temizle
find "$YEDEK_DIZINI" -name 'ozdede-*.sql.gz' -mtime +$SAKLAMA_GUNU -delete

echo "[$(date -Is)] Mevcut yedek sayısı: $(find "$YEDEK_DIZINI" -name 'ozdede-*.sql.gz' | wc -l)"
