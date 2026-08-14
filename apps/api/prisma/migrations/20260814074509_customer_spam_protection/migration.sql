-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "message_burst_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "message_burst_window_start" TIMESTAMPTZ(3),
ADD COLUMN     "silenced_until" TIMESTAMPTZ(3);
