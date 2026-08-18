-- Sahte numaralarla takvimi doldurma girişimlerine karşı.
--
-- Randevuyu oluşturan istemcinin IP'sinin HMAC özeti tutulur; IP'nin
-- KENDİSİ saklanmaz. İki işi var:
--   1. Aynı cihazdan günde en fazla 3 FARKLI numaraya randevu alınabilsin.
--   2. Saldırı olursa berber aynı kaynaktan gelen randevuları tek işlemle
--      iptal edebilsin.
--
-- Eklemeli değişiklik: sütun nullable, mevcut randevular NULL kalır.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "client_hash" TEXT;

-- CreateIndex
CREATE INDEX "appointments_shop_id_client_hash_starts_at_idx" ON "appointments"("shop_id", "client_hash", "starts_at");
