-- CreateEnum
CREATE TYPE "AppIntent" AS ENUM ('STUDY', 'TUTORIAL', 'ENTERTAINMENT', 'RELAXATION', 'AVOIDING_WORK');

-- CreateEnum
CREATE TYPE "InterventionType" AS ENUM ('NUDGE', 'PAUSE', 'REFLECTION', 'SLEEP_MODE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "appOpened" TEXT NOT NULL,
    "declaredIntent" "AppIntent" NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotScore" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "focusFragmentation" DOUBLE PRECISION NOT NULL,
    "passiveRatio" DOUBLE PRECISION NOT NULL,
    "cognitiveDrift" DOUBLE PRECISION NOT NULL,
    "doomscrollProbability" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "type" "InterventionType" NOT NULL,
    "message" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEmbedding" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "embedding" vector(1536) NOT NULL,

    CONSTRAINT "SessionEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotScore" ADD CONSTRAINT "AutopilotScore_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEmbedding" ADD CONSTRAINT "SessionEmbedding_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
