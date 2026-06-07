-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "scrollVelocity" DOUBLE PRECISION NOT NULL,
    "tabSwitchCount" INTEGER NOT NULL,
    "clickRate" DOUBLE PRECISION NOT NULL,
    "passiveTime" DOUBLE PRECISION NOT NULL,
    "activeTime" DOUBLE PRECISION NOT NULL,
    "scrollDepthPercent" DOUBLE PRECISION,
    "pageResetCount" INTEGER,
    "activeDomain" TEXT,
    "contentType" TEXT,
    "secondsSinceIntent" INTEGER NOT NULL,
    "hourOfDay" INTEGER NOT NULL,
    "runningDrift" DOUBLE PRECISION NOT NULL,
    "isPomodoroBreak" BOOLEAN NOT NULL DEFAULT false,
    "onsetLabel" BOOLEAN,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_timestamp_idx" ON "SessionEvent"("sessionId", "timestamp");

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
