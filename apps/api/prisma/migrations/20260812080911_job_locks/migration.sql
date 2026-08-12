-- CreateTable
CREATE TABLE "job_locks" (
    "name" TEXT NOT NULL,
    "locked_until" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);
