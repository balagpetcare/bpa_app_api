-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PetStatus" AS ENUM ('ACTIVE', 'DECEASED', 'LOST', 'ADOPTED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BKASH', 'NAGAD', 'ROCKET', 'BANK', 'CARD');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'FOLLOWERS_ONLY');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE', 'FACEBOOK', 'APPLE');

-- CreateTable
CREATE TABLE "animal_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "animal_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breeds" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "animalTypeId" INTEGER NOT NULL,

    CONSTRAINT "breeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_auth" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "passwordUpdatedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_auth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "bio" TEXT,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
    "showEmail" BOOLEAN NOT NULL DEFAULT false,
    "showPhone" BOOLEAN NOT NULL DEFAULT false,
    "avatarMediaId" INTEGER,
    "coverMediaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats_cache" (
    "userId" INTEGER NOT NULL,
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "followingCount" INTEGER NOT NULL DEFAULT 0,
    "petsCount" INTEGER NOT NULL DEFAULT 0,
    "pawPoints" INTEGER NOT NULL DEFAULT 0,
    "rankGlobal" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_cache_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_follows" (
    "id" SERIAL NOT NULL,
    "followerId" INTEGER NOT NULL,
    "followingId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pointsReward" INTEGER NOT NULL DEFAULT 0,
    "iconMediaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "achievementId" INTEGER NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_gallery_items" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_gallery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pets" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "animalTypeId" INTEGER NOT NULL,
    "breedId" INTEGER,
    "profilePicId" INTEGER,
    "name" TEXT NOT NULL,
    "sex" "Gender" NOT NULL DEFAULT 'UNKNOWN',
    "dateOfBirth" TIMESTAMP(3),
    "microchipNumber" TEXT,
    "isRescue" BOOLEAN NOT NULL DEFAULT false,
    "isNeutered" BOOLEAN NOT NULL DEFAULT false,
    "foodHabits" TEXT,
    "healthDisorders" TEXT,
    "notes" TEXT,
    "status" "PetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_weights" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccine_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "targetAnimalTypeId" INTEGER,
    "defaultIntervalDays" INTEGER NOT NULL DEFAULT 365,
    "description" TEXT,

    CONSTRAINT "vaccine_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccinations" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "vaccineTypeId" INTEGER NOT NULL,
    "administeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueDate" TIMESTAMP(3),
    "batchNumber" TEXT,
    "vetClinic" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deworming_records" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "medicationName" TEXT NOT NULL,
    "dosage" TEXT,
    "weightAtTime" DOUBLE PRECISION,
    "administeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deworming_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_histories" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "treatment" TEXT,
    "doctorName" TEXT,
    "clinicName" TEXT,
    "visitDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_wallets" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "points" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'Bronze',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" SERIAL NOT NULL,
    "walletId" INTEGER NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod",
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_histories" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "animal_types_name_key" ON "animal_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "breeds_name_animalTypeId_key" ON "breeds"("name", "animalTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "user_auth_userId_key" ON "user_auth"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_auth_email_key" ON "user_auth"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_auth_phone_key" ON "user_auth"("phone");

-- CreateIndex
CREATE INDEX "user_auth_email_idx" ON "user_auth"("email");

-- CreateIndex
CREATE INDEX "user_auth_phone_idx" ON "user_auth"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_username_key" ON "user_profiles"("username");

-- CreateIndex
CREATE INDEX "user_profiles_username_idx" ON "user_profiles"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshTokenHash_key" ON "user_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_expiresAt_idx" ON "user_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "user_follows_followingId_idx" ON "user_follows"("followingId");

-- CreateIndex
CREATE INDEX "user_follows_followerId_idx" ON "user_follows"("followerId");

-- CreateIndex
CREATE UNIQUE INDEX "user_follows_followerId_followingId_key" ON "user_follows"("followerId", "followingId");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");

-- CreateIndex
CREATE INDEX "user_achievements_userId_idx" ON "user_achievements"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_achievementId_key" ON "user_achievements"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "user_gallery_items_userId_createdAt_idx" ON "user_gallery_items"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pets_profilePicId_key" ON "pets"("profilePicId");

-- CreateIndex
CREATE UNIQUE INDEX "pets_microchipNumber_key" ON "pets"("microchipNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vaccine_types_name_key" ON "vaccine_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_wallets_userId_key" ON "user_wallets"("userId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_idx" ON "wallet_transactions"("walletId");

-- AddForeignKey
ALTER TABLE "breeds" ADD CONSTRAINT "breeds_animalTypeId_fkey" FOREIGN KEY ("animalTypeId") REFERENCES "animal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_auth" ADD CONSTRAINT "user_auth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats_cache" ADD CONSTRAINT "user_stats_cache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_iconMediaId_fkey" FOREIGN KEY ("iconMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_gallery_items" ADD CONSTRAINT "user_gallery_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_gallery_items" ADD CONSTRAINT "user_gallery_items_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_animalTypeId_fkey" FOREIGN KEY ("animalTypeId") REFERENCES "animal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "breeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_profilePicId_fkey" FOREIGN KEY ("profilePicId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_weights" ADD CONSTRAINT "pet_weights_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccine_types" ADD CONSTRAINT "vaccine_types_targetAnimalTypeId_fkey" FOREIGN KEY ("targetAnimalTypeId") REFERENCES "animal_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_vaccineTypeId_fkey" FOREIGN KEY ("vaccineTypeId") REFERENCES "vaccine_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deworming_records" ADD CONSTRAINT "deworming_records_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_histories" ADD CONSTRAINT "medical_histories_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "user_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_histories" ADD CONSTRAINT "reward_histories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
