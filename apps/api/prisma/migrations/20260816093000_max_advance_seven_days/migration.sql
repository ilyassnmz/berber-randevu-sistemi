-- Müşterinin alabileceği en ileri randevu tarihi 30 günden 7 güne çekiliyor.
--
-- Not: bu sınır artık yalnızca MÜŞTERİ tarafına (internet sitesi, chatbot)
-- uygulanıyor. Berber panelden istediği tarihe randevu girebiliyor
-- (services/appointments.ts → BookingActor).

-- AlterTable: yeni dükkanlar için varsayılan
ALTER TABLE "shops" ALTER COLUMN "max_advance_days" SET DEFAULT 7;

-- Mevcut dükkan(lar): yalnızca eski varsayılanda kalmış olanlar güncellenir.
-- Bilerek koşullu — ileride bir dükkana özel bir değer verilmişse ezilmesin.
UPDATE "shops" SET "max_advance_days" = 7 WHERE "max_advance_days" = 30;
