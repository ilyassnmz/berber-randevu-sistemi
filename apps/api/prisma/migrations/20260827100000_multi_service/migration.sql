-- Bir randevuda birden fazla hizmet.
--
-- Müşteri artık "saç + ağda" gibi birden fazla hizmet seçebiliyor. Süreler
-- toplanmıyor (ikisi aynı oturumda yapılıyor); yalnızca "ayrı zaman ister"
-- işaretli hizmetler randevuyu uzatıyor. Bkz. packages/shared/src/duration.ts.
--
-- Değişiklik tamamen EKLEMELİ; mevcut randevular olduğu gibi çalışmaya
-- devam eder:
--   * appointments.service_id KALIYOR — artık "ana hizmet" anlamında.
--   * Yeni tabloya mevcut her randevu için kendi hizmeti yazılıyor, böylece
--     eski ve yeni randevular aynı biçimde okunuyor (küme her zaman dolu).

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "requires_own_slot" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "appointment_services" (
    "appointment_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,

    CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("appointment_id","service_id")
);

-- CreateIndex
CREATE INDEX "appointment_services_service_id_idx" ON "appointment_services"("service_id");

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Geçmişi yeni biçime taşı: her mevcut randevunun tek hizmeti, kümesinin de
-- tek üyesi olur. Bu olmadan eski randevular "hizmetsiz" görünürdü.
INSERT INTO "appointment_services" ("appointment_id", "service_id")
SELECT "id", "service_id" FROM "appointments"
ON CONFLICT DO NOTHING;
