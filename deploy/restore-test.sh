#!/bin/bash
#
# YEDEK GERİ YÜKLEME PROVASI
#
# Kullanım:  ./restore-test.sh [yedek-dosyasi]
#
# Yedeği AYRI bir deneme veritabanına geri yükler, içeriğini sayar ve
# veritabanını siler. Üretime asla dokunmaz.
#
# ── Neden ayrı bir betik? ────────────────────────────────────────
#
# Bu prova bir kez elle yapılırken hedef veritabanı adı yanlış hesaplandı ve
# geri yükleme ÜRETİME çalıştı. Veri kaybı olmadı — yalnızca psql'in
# ON_ERROR_STOP bayrağı ilk ifadede durdurduğu için. Yani felaketi tesadüf
# önledi.
#
# Bu yüzden hedef burada elle hesaplanmıyor ve altta sert bir kilit var:
# hedef, üretim veritabanının adıyla aynıysa betik ÇALIŞMAYI REDDEDER.

set -euo pipefail

DENEME_DB="ozdede_geriyukleme_denemesi"

set -a
# shellcheck disable=SC1091
source /opt/ozdede/.env
set +a

KAYNAK_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"

# ── URL'i güvenle parçala ────────────────────────────────────────
# sed/regex KULLANILMIYOR: tam da onun sessizce eşleşmemesi yüzünden
# geri yükleme üretime gitmişti. Kabuk parametre genişletmesi belirsizlik
# bırakmıyor.
GOVDE="${KAYNAK_URL%%\?*}"          # sorgu dizesinden önceki kısım
SORGU=""
if [[ "$KAYNAK_URL" == *\?* ]]; then SORGU="?${KAYNAK_URL#*\?}"; fi
ONEK="${GOVDE%/*}"                  # son eğik çizgiye kadar
URETIM_DB="${GOVDE##*/}"            # üretim veritabanının adı

HEDEF_URL="$ONEK/$DENEME_DB$SORGU"

# ── SERT KİLİT ───────────────────────────────────────────────────
if [ "$DENEME_DB" = "$URETIM_DB" ]; then
  echo "DURDURULDU: hedef veritabanı üretimle aynı ($URETIM_DB)." >&2
  echo "Geri yükleme provası ÜRETİME çalıştırılamaz." >&2
  exit 1
fi

if [[ "$HEDEF_URL" != *"/$DENEME_DB"* ]]; then
  echo "DURDURULDU: hedef adres beklendiği gibi kurulamadı." >&2
  echo "Hesaplanan: $HEDEF_URL" >&2
  exit 1
fi

YEDEK="${1:-$(ls -t /opt/backups/ozdede-*.sql.gz | head -1)}"

echo "Yedek        : $YEDEK"
echo "Üretim DB    : $URETIM_DB  (DOKUNULMAYACAK)"
echo "Deneme DB    : $DENEME_DB"
echo ""

PSQL="docker run --rm -i postgres:18-alpine psql"

echo "[1/4] Deneme veritabanı sıfırlanıyor..."
$PSQL "$KAYNAK_URL" -q -c "DROP DATABASE IF EXISTS $DENEME_DB" >/dev/null
$PSQL "$KAYNAK_URL" -q -c "CREATE DATABASE $DENEME_DB" >/dev/null

echo "[2/4] Yedek geri yükleniyor..."
gunzip -c "$YEDEK" | $PSQL "$HEDEF_URL" -v ON_ERROR_STOP=1 -q >/dev/null

echo "[3/4] İçerik sayılıyor..."
$PSQL "$HEDEF_URL" -q -t -c "
  SELECT '  dükkan   : ' || (SELECT count(*) FROM shops)
  UNION ALL SELECT '  berber   : ' || (SELECT count(*) FROM barbers)
  UNION ALL SELECT '  müşteri  : ' || (SELECT count(*) FROM customers)
  UNION ALL SELECT '  randevu  : ' || (SELECT count(*) FROM appointments)
  UNION ALL SELECT '  hizmet   : ' || (SELECT count(*) FROM services);"

echo "[4/4] Deneme veritabanı siliniyor..."
$PSQL "$KAYNAK_URL" -q -c "DROP DATABASE $DENEME_DB" >/dev/null

echo ""
echo "PROVA BAŞARILI — yedek geri yüklenebiliyor."
