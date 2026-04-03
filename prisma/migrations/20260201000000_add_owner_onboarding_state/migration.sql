-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'PATH_SELECTED', 'ORG_DRAFT', 'BRANCH_DRAFT', 'REVIEW_READY', 'COMPLETED', 'FAILED_RECOVERABLE');

-- CreateEnum
CREATE TYPE "OnboardingPath" AS ENUM ('CREATE_NEW', 'JOIN_EXISTING');

-- CreateTable
CREATE TABLE "owner_onboarding_states" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "selectedPath" "OnboardingPath",
    "lastCompletedStep" VARCHAR(32),
    "draftDataJson" JSONB,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "failureCode" VARCHAR(64),
    "failureMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_onboarding_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owner_onboarding_states_userId_key" ON "owner_onboarding_states"("userId");

-- CreateIndex
CREATE INDEX "owner_onboarding_states_userId_idx" ON "owner_onboarding_states"("userId");

-- CreateIndex
CREATE INDEX "owner_onboarding_states_status_idx" ON "owner_onboarding_states"("status");

-- AddForeignKey
ALTER TABLE "owner_onboarding_states" ADD CONSTRAINT "owner_onboarding_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
