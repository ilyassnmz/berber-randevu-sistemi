-- CreateEnum
CREATE TYPE "BarberRole" AS ENUM ('admin', 'staff');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('pending_confirm', 'confirmed', 'cancelled', 'completed', 'no_show');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('customer', 'barber', 'system');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('whatsapp', 'panel');

-- CreateEnum
CREATE TYPE "MessageCategory" AS ENUM ('service', 'utility', 'marketing');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "slot_step_min" INTEGER NOT NULL DEFAULT 45,
    "max_advance_days" INTEGER NOT NULL DEFAULT 30,
    "cancel_cutoff_min" INTEGER NOT NULL DEFAULT 120,
    "confirm_timeout_min" INTEGER NOT NULL DEFAULT 5,
    "whatsapp_phone_id" TEXT,
    "contact_phone" TEXT,
    "privacy_policy_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barbers" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "BarberRole" NOT NULL DEFAULT 'staff',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "barbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "is_blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklist_note" TEXT,
    "opted_out" BOOLEAN NOT NULL DEFAULT false,
    "consent_at" TIMESTAMPTZ(3),
    "last_inbound_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 45,
    "price" DECIMAL(10,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "barber_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_working" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_off" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "barber_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "barber_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'pending_confirm',
    "cancelled_by" "CancelledBy",
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "source" "AppointmentSource" NOT NULL DEFAULT 'whatsapp',
    "confirm_deadline" TIMESTAMPTZ(3),
    "reminder_1day_sent_at" TIMESTAMPTZ(3),
    "reminder_1hour_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'idle',
    "context" JSONB NOT NULL DEFAULT '{}',
    "invalid_input_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "wamid" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "customer_id" UUID,
    "wamid" TEXT,
    "template_name" TEXT,
    "category" "MessageCategory",
    "body_preview" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "error_code" TEXT,
    "error_text" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "barber_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "barber_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- CreateIndex
CREATE INDEX "barbers_shop_id_is_active_idx" ON "barbers"("shop_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "barbers_shop_id_email_key" ON "barbers"("shop_id", "email");

-- CreateIndex
CREATE INDEX "customers_shop_id_is_blacklisted_idx" ON "customers"("shop_id", "is_blacklisted");

-- CreateIndex
CREATE UNIQUE INDEX "customers_shop_id_phone_key" ON "customers"("shop_id", "phone");

-- CreateIndex
CREATE INDEX "services_shop_id_is_active_sort_order_idx" ON "services"("shop_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "services_shop_id_name_key" ON "services"("shop_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "working_hours_barber_id_day_of_week_key" ON "working_hours"("barber_id", "day_of_week");

-- CreateIndex
CREATE INDEX "time_off_shop_id_starts_at_ends_at_idx" ON "time_off"("shop_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "time_off_barber_id_starts_at_idx" ON "time_off"("barber_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_barber_id_starts_at_idx" ON "appointments"("barber_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_customer_id_starts_at_idx" ON "appointments"("customer_id", "starts_at" DESC);

-- CreateIndex
CREATE INDEX "appointments_shop_id_starts_at_idx" ON "appointments"("shop_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_status_confirm_deadline_idx" ON "appointments"("status", "confirm_deadline");

-- CreateIndex
CREATE UNIQUE INDEX "chat_sessions_phone_key" ON "chat_sessions"("phone");

-- CreateIndex
CREATE INDEX "chat_sessions_expires_at_idx" ON "chat_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_wamid_key" ON "webhook_events"("wamid");

-- CreateIndex
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_wamid_key" ON "outbound_messages"("wamid");

-- CreateIndex
CREATE INDEX "outbound_messages_shop_id_created_at_idx" ON "outbound_messages"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "outbound_messages_customer_id_created_at_idx" ON "outbound_messages"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_barber_id_idx" ON "refresh_tokens"("barber_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_barber_id_idx" ON "push_subscriptions"("barber_id");

-- CreateIndex
CREATE INDEX "audit_log_shop_id_created_at_idx" ON "audit_log"("shop_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "barbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "barbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "barbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
--  Ã‡AKIÅMA KISITI â€” Sistemin en kritik tek parÃ§asÄ±
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
--
--  Bu SQL, ilk migration dosyasÄ±nÄ±n (prisma/migrations/*_init/migration.sql)
--  SONUNA eklenir. Kurulum adÄ±mlarÄ± README.md â†’ "VeritabanÄ± kurulumu"nda.
--
--  â”€â”€ Neden gerekli? â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
--
--  Ä°ki mÃ¼ÅŸteri aynÄ± anda "09:00" seÃ§tiÄŸinde uygulama ÅŸunu yapar:
--
--      1. "Bu saat boÅŸ mu?"  â†’ Postgres: "boÅŸ"
--      2. INSERT
--
--  Ä°ki istek aynÄ± anda gelirse Ä°KÄ°SÄ° de 1. adÄ±mda "boÅŸ" cevabÄ±nÄ± alÄ±r ve
--  ikisi de INSERT eder. Berber saat 09:00'da iki mÃ¼ÅŸteriyle karÅŸÄ±laÅŸÄ±r.
--
--  Bu, uygulama kodunda kontrol ekleyerek Ã§Ã¶zÃ¼lemez â€” kontrol ile yazma
--  arasÄ±nda her zaman bir aralÄ±k kalÄ±r. Ã‡Ã¶zÃ¼m, kuralÄ± veritabanÄ±nÄ±n kendisine
--  Ã¶ÄŸretmektir: aÅŸaÄŸÄ±daki kÄ±sÄ±t Ã§akÄ±ÅŸan iki randevuyu FÄ°ZÄ°KSEL OLARAK kabul
--  etmez. Uygulama hata yapsa bile olamaz.
--
--  UygulamanÄ±n tek gÃ¶revi, ikinci INSERT'in aldÄ±ÄŸÄ± 23P01 (exclusion_violation)
--  hatasÄ±nÄ± yakalayÄ±p mÃ¼ÅŸteriye "bu saat az Ã¶nce doldu" demektir.
--  Bkz. src/lib/errors.ts â†’ isOverlapViolation()
--
--  â”€â”€ Neden sadece pending_confirm ve confirmed? â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
--
--  Ä°ptal edilmiÅŸ, tamamlanmÄ±ÅŸ veya gelinmemiÅŸ randevular slotu tutmaz;
--  o saate yeni randevu alÄ±nabilmeli. Bu liste kodda BLOCKING_STATUSES ile
--  aynÄ± olmak zorunda (packages/shared/src/constants.ts) â€” biri deÄŸiÅŸirse
--  diÄŸeri de deÄŸiÅŸmeli.

-- GiST indeksinin UUID eÅŸitliÄŸi (barber_id WITH =) ile aralÄ±k Ã§akÄ±ÅŸmasÄ±nÄ±
-- (&&) aynÄ± indekste birleÅŸtirebilmesi iÃ§in gerekli.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "barber_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('pending_confirm', 'confirmed'));

--  '[)' aralÄ±k tipi: baÅŸlangÄ±Ã§ dahil, bitiÅŸ hariÃ§.
--  09:00â€“09:45 ile 09:45â€“10:30 randevularÄ± BÄ°TÄ°ÅÄ°K sayÄ±lÄ±r, Ã§akÄ±ÅŸmaz.
--  Bu olmadan her randevu bir sonrakini bloke ederdi.

COMMENT ON CONSTRAINT "appointments_no_overlap" ON "appointments" IS
  'AynÄ± berbere Ã§akÄ±ÅŸan randevu girilmesini engeller. Uygulama 23P01 hatasÄ±nÄ± yakalar.';

