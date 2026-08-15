-- Siteden randevu alma (public booking) için gereken iki eklemeli değişiklik.
--
-- Üçü de mevcut veriye dokunmaz:
--   * ADD VALUE  : yeni enum değeri, eski satırlar etkilenmez
--   * ADD COLUMN : nullable, varsayılanı yok — eski randevularda NULL kalır
--   * UNIQUE     : PostgreSQL NULL'ları birbirinden farklı sayar, dolayısıyla
--                  hepsi NULL olan mevcut satırlar kısıtı ihlal etmez

-- AlterEnum
ALTER TYPE "AppointmentSource" ADD VALUE 'web';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "public_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "appointments_public_token_key" ON "appointments"("public_token");
