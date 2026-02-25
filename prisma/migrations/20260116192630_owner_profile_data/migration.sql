-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PetStatus" AS ENUM ('ACTIVE', 'DECEASED', 'LOST', 'ADOPTED');

-- CreateEnum
CREATE TYPE "FamilyRelation" AS ENUM ('OWNER', 'DAD', 'MOM', 'BROTHER', 'SISTER', 'OTHER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'FOLLOWERS_ONLY');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE', 'FACEBOOK', 'APPLE');

-- CreateEnum
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'REEL');

-- CreateEnum
CREATE TYPE "PostCategory" AS ENUM ('GENERAL', 'FUNDRAISING', 'FUNDRAISING_UPDATE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BKASH', 'NAGAD', 'ROCKET', 'BANK', 'CARD');

-- CreateEnum
CREATE TYPE "WalletSourceType" AS ENUM ('DONATION', 'WALLET_WITHDRAW_REQUEST', 'FUNDRAISING_WITHDRAW_REQUEST', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutProvider" AS ENUM ('BKASH', 'NAGAD', 'ROCKET');

-- CreateEnum
CREATE TYPE "WalletWithdrawRequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'QUEUED', 'PROCESSING', 'TRANSFERRED', 'FAILED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PayoutMethodType" AS ENUM ('MFS', 'BANK');

-- CreateEnum
CREATE TYPE "FundraisingWithdrawRequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'TRANSFERRED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('POST', 'FUNDRAISING', 'USER', 'PET');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'REVIEWED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FundraisingAccountStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FundraisingAccountType" AS ENUM ('INDIVIDUAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "FundraisingCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('ORGANIZATION', 'BRANCH', 'OWNER_KYC');

-- CreateEnum
CREATE TYPE "AuditActorRole" AS ENUM ('OWNER', 'ADMIN', 'SUPER_ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('NOT_APPLIED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BranchTypeCode" AS ENUM ('CLINIC', 'PET_SHOP', 'DELIVERY_HUB', 'WAREHOUSE_DC', 'GROOMING_SPA', 'BOARDING_DAYCARE', 'FOSTER_SHELTER', 'TRAINING_BEHAVIOR', 'PHARMACY_DIAGNOSTICS');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNSUBMITTED', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationEntityType" AS ENUM ('OWNER', 'ORGANIZATION', 'BRANCH');

-- CreateEnum
CREATE TYPE "VerificationAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'NOTE', 'LOCK', 'UNLOCK');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NID_FRONT', 'NID_BACK', 'SELFIE_WITH_NID', 'TRADE_LICENSE', 'TIN_CERT', 'BIN_CERT', 'INCORPORATION_CERT', 'PARTNERSHIP_DEED', 'BOARD_RESOLUTION', 'BANK_CHEQUE_LEAF', 'STORE_FRONT_PHOTO', 'STORE_INSIDE_PHOTO', 'SIGNBOARD_PHOTO', 'VET_LICENSE', 'DRUG_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_COMPANY', 'NGO');

-- CreateEnum
CREATE TYPE "PublishRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

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
CREATE TABLE "user_profile_likes" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "likedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profile_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_friend_requests" (
    "id" SERIAL NOT NULL,
    "fromUserId" INTEGER NOT NULL,
    "toUserId" INTEGER NOT NULL,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_friend_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_friends" (
    "id" SERIAL NOT NULL,
    "userAId" INTEGER NOT NULL,
    "userBId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_friends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requiredPoints" INTEGER NOT NULL DEFAULT 0,
    "pointsReward" INTEGER NOT NULL DEFAULT 0,
    "howTo" TEXT,
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
CREATE TABLE "owner_profiles" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "supportPhone" TEXT,
    "supportEmail" TEXT,
    "divisionId" INTEGER,
    "districtId" INTEGER,
    "upazilaId" INTEGER,
    "areaId" INTEGER,
    "nid" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "genderText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_kyc" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "fatherName" TEXT,
    "motherName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "genderText" TEXT,
    "nationality" TEXT DEFAULT 'Bangladeshi',
    "nidNumber" TEXT,
    "nidIssueDate" TIMESTAMP(3),
    "nidAddressRaw" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "presentAddressJson" JSONB,
    "permanentAddressJson" JSONB,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "riskScore" INTEGER DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_kyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_kyc_documents" (
    "id" SERIAL NOT NULL,
    "ownerKycId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "mediaId" INTEGER NOT NULL,
    "docNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_legal_profiles" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "organizationName" TEXT NOT NULL,
    "registrationType" "RegistrationType" NOT NULL DEFAULT 'PROPRIETORSHIP',
    "tradeLicenseNumber" TEXT,
    "tradeLicenseIssueDate" TIMESTAMP(3),
    "tradeLicenseExpiryDate" TIMESTAMP(3),
    "issuingAuthority" TEXT,
    "tinNumber" TEXT,
    "binNumber" TEXT,
    "officialPhone" TEXT,
    "officialEmail" TEXT,
    "website" TEXT,
    "facebookPage" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankName" TEXT,
    "bankBranchName" TEXT,
    "routingNumber" TEXT,
    "payoutBkash" TEXT,
    "payoutNagad" TEXT,
    "payoutRocket" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_legal_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_documents" (
    "id" SERIAL NOT NULL,
    "orgLegalProfileId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "mediaId" INTEGER NOT NULL,
    "docNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_directors" (
    "id" SERIAL NOT NULL,
    "orgLegalProfileId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "nidNumber" TEXT,
    "sharePercentage" DOUBLE PRECISION,
    "nidFrontMediaId" INTEGER,
    "nidBackMediaId" INTEGER,
    "signatureMediaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_directors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_profile_details" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "branchPhone" TEXT,
    "branchEmail" TEXT,
    "managerName" TEXT,
    "managerPhone" TEXT,
    "managerNidNumber" TEXT,
    "addressJson" JSONB,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "googleMapLink" TEXT,
    "openingHoursJson" JSONB,
    "weeklyOffDaysJson" JSONB,
    "vetLicenseNumber" TEXT,
    "drugLicenseNumber" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_profile_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_documents" (
    "id" SERIAL NOT NULL,
    "branchProfileId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "mediaId" INTEGER NOT NULL,
    "docNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_logs" (
    "id" SERIAL NOT NULL,
    "entityType" "VerificationEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" "VerificationAction" NOT NULL,
    "fromStatus" "VerificationStatus",
    "toStatus" "VerificationStatus",
    "adminUserId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,
    "type" "PostType" NOT NULL DEFAULT 'TEXT',
    "category" "PostCategory" NOT NULL DEFAULT 'GENERAL',
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_likes" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comment_likes" (
    "id" SERIAL NOT NULL,
    "commentId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comment_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),

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
CREATE TABLE "pet_family_members" (
    "id" SERIAL NOT NULL,
    "petId" INTEGER NOT NULL,
    "relation" "FamilyRelation" NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "avatarMediaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_family_members_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "user_wallets" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "availableBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "pendingBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "lockedBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
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
    "sourceType" "WalletSourceType",
    "sourceId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_withdraw_requests" (
    "id" SERIAL NOT NULL,
    "walletId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "payoutDetailsJson" TEXT NOT NULL,
    "provider" "PayoutProvider",
    "providerPayoutId" TEXT,
    "providerStatus" TEXT,
    "providerResponseJson" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "WalletWithdrawRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT,
    "adminUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_withdraw_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_event_logs" (
    "id" SERIAL NOT NULL,
    "provider" "PayoutProvider" NOT NULL,
    "providerEventId" TEXT,
    "providerPayoutId" TEXT,
    "withdrawRequestId" INTEGER,
    "payloadJson" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_updates" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_accounts" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "FundraisingAccountStatus" NOT NULL DEFAULT 'PENDING',
    "accountType" "FundraisingAccountType",
    "permanentAddress" TEXT,
    "presentAddress" TEXT,
    "occupation" TEXT,
    "area" TEXT,
    "rescueSinceYear" INTEGER,
    "orgName" TEXT,
    "orgDescription" TEXT,
    "orgWorkType" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "divisionId" INTEGER,
    "districtId" INTEGER,
    "upazilaId" INTEGER,
    "areaId" INTEGER,
    "dateOfBirth" TIMESTAMP(3),
    "nationalIdNumber" TEXT,
    "birthRegNumber" TEXT,
    "studentIdNumber" TEXT,

    CONSTRAINT "fundraising_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_account_status_logs" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "fromStatus" "FundraisingAccountStatus" NOT NULL,
    "toStatus" "FundraisingAccountStatus" NOT NULL,
    "adminUserId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundraising_account_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_verification_documents" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_campaigns" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "targetAmount" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "locationText" TEXT,
    "status" "FundraisingCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_campaign_stats" (
    "campaignId" INTEGER NOT NULL,
    "raisedAmount" INTEGER NOT NULL DEFAULT 0,
    "withdrawnAmount" INTEGER NOT NULL DEFAULT 0,
    "donorsCount" INTEGER NOT NULL DEFAULT 0,
    "lastDonationAt" TIMESTAMP(3),
    "lastPayoutAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_campaign_stats_pkey" PRIMARY KEY ("campaignId")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "donorId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_payout_method_catalog" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PayoutMethodType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requirementsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fundraising_payout_method_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_payout_methods" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "catalogId" INTEGER NOT NULL,
    "label" TEXT,
    "detailsJson" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_payout_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_withdraw_requests" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "methodId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "FundraisingWithdrawRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT,
    "adminUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fundraising_withdraw_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fundraising_payout_transfer_logs" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "reference" TEXT,
    "proofMediaId" INTEGER,
    "methodSnapshotJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fundraising_payout_transfer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "type" "ReportTargetType" NOT NULL,
    "targetId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bd_divisions" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bd_divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bd_districts" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT,
    "divisionId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bd_districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bd_upazilas" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT,
    "districtId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bd_upazilas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bd_areas" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT,
    "type" TEXT NOT NULL,
    "upazilaId" INTEGER,
    "districtId" INTEGER,
    "parentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bd_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_corporations" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "city_corporations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" SERIAL NOT NULL,
    "cityCorporationId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT,
    "searchKeywords" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "AuditActorRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_applications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "businessName" TEXT NOT NULL,
    "nidNumber" TEXT NOT NULL,
    "tradeLicenseNo" TEXT,
    "docsJson" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "reviewedByAdminId" INTEGER,

    CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "name" TEXT NOT NULL,
    "supportPhone" TEXT,
    "addressJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BranchStatus" NOT NULL DEFAULT 'DRAFT',
    "capabilitiesJson" JSONB NOT NULL DEFAULT '{}',
    "featuresJson" JSONB NOT NULL DEFAULT '{}',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNSUBMITTED',
    "addressJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchTypeOnBranch" (
    "branchId" INTEGER NOT NULL,
    "branchTypeId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchTypeOnBranch_pkey" PRIMARY KEY ("branchId","branchTypeId")
);

-- CreateTable
CREATE TABLE "branch_publish_requests" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "status" "PublishRequestStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" INTEGER,
    "note" TEXT,

    CONSTRAINT "branch_publish_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_types" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_types" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameBn" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_to_types" (
    "branchId" INTEGER NOT NULL,
    "typeId" INTEGER NOT NULL,

    CONSTRAINT "branch_to_types_pkey" PRIMARY KEY ("branchId","typeId")
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
CREATE INDEX "user_profile_likes_userId_idx" ON "user_profile_likes"("userId");

-- CreateIndex
CREATE INDEX "user_profile_likes_likedById_idx" ON "user_profile_likes"("likedById");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_likes_userId_likedById_key" ON "user_profile_likes"("userId", "likedById");

-- CreateIndex
CREATE INDEX "user_friend_requests_toUserId_idx" ON "user_friend_requests"("toUserId");

-- CreateIndex
CREATE INDEX "user_friend_requests_fromUserId_idx" ON "user_friend_requests"("fromUserId");

-- CreateIndex
CREATE UNIQUE INDEX "user_friend_requests_fromUserId_toUserId_key" ON "user_friend_requests"("fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "user_friends_userAId_idx" ON "user_friends"("userAId");

-- CreateIndex
CREATE INDEX "user_friends_userBId_idx" ON "user_friends"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "user_friends_userAId_userBId_key" ON "user_friends"("userAId", "userBId");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");

-- CreateIndex
CREATE INDEX "user_achievements_userId_idx" ON "user_achievements"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_achievements_userId_achievementId_key" ON "user_achievements"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "user_gallery_items_userId_createdAt_idx" ON "user_gallery_items"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "owner_profiles_userId_key" ON "owner_profiles"("userId");

-- CreateIndex
CREATE INDEX "owner_profiles_userId_idx" ON "owner_profiles"("userId");

-- CreateIndex
CREATE INDEX "owner_profiles_divisionId_idx" ON "owner_profiles"("divisionId");

-- CreateIndex
CREATE INDEX "owner_profiles_districtId_idx" ON "owner_profiles"("districtId");

-- CreateIndex
CREATE INDEX "owner_profiles_upazilaId_idx" ON "owner_profiles"("upazilaId");

-- CreateIndex
CREATE INDEX "owner_profiles_areaId_idx" ON "owner_profiles"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_kyc_userId_key" ON "owner_kyc"("userId");

-- CreateIndex
CREATE INDEX "owner_kyc_verificationStatus_idx" ON "owner_kyc"("verificationStatus");

-- CreateIndex
CREATE INDEX "owner_kyc_reviewedByAdminId_idx" ON "owner_kyc"("reviewedByAdminId");

-- CreateIndex
CREATE INDEX "owner_kyc_documents_ownerKycId_idx" ON "owner_kyc_documents"("ownerKycId");

-- CreateIndex
CREATE INDEX "owner_kyc_documents_type_idx" ON "owner_kyc_documents"("type");

-- CreateIndex
CREATE UNIQUE INDEX "org_legal_profiles_orgId_key" ON "org_legal_profiles"("orgId");

-- CreateIndex
CREATE INDEX "org_legal_profiles_verificationStatus_idx" ON "org_legal_profiles"("verificationStatus");

-- CreateIndex
CREATE INDEX "org_legal_profiles_reviewedByAdminId_idx" ON "org_legal_profiles"("reviewedByAdminId");

-- CreateIndex
CREATE INDEX "org_documents_orgLegalProfileId_idx" ON "org_documents"("orgLegalProfileId");

-- CreateIndex
CREATE INDEX "org_documents_type_idx" ON "org_documents"("type");

-- CreateIndex
CREATE INDEX "org_directors_orgLegalProfileId_idx" ON "org_directors"("orgLegalProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_profile_details_branchId_key" ON "branch_profile_details"("branchId");

-- CreateIndex
CREATE INDEX "branch_profile_details_verificationStatus_idx" ON "branch_profile_details"("verificationStatus");

-- CreateIndex
CREATE INDEX "branch_profile_details_reviewedByAdminId_idx" ON "branch_profile_details"("reviewedByAdminId");

-- CreateIndex
CREATE INDEX "branch_documents_branchProfileId_idx" ON "branch_documents"("branchProfileId");

-- CreateIndex
CREATE INDEX "branch_documents_type_idx" ON "branch_documents"("type");

-- CreateIndex
CREATE INDEX "verification_logs_entityType_entityId_idx" ON "verification_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "verification_logs_adminUserId_idx" ON "verification_logs"("adminUserId");

-- CreateIndex
CREATE INDEX "posts_authorId_createdAt_idx" ON "posts"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "post_media_postId_idx" ON "post_media"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "post_media_postId_order_key" ON "post_media"("postId", "order");

-- CreateIndex
CREATE INDEX "post_likes_userId_idx" ON "post_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "post_likes_postId_userId_key" ON "post_likes"("postId", "userId");

-- CreateIndex
CREATE INDEX "post_comments_postId_createdAt_idx" ON "post_comments"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "post_comments_userId_idx" ON "post_comments"("userId");

-- CreateIndex
CREATE INDEX "post_comments_parentId_idx" ON "post_comments"("parentId");

-- CreateIndex
CREATE INDEX "post_comment_likes_userId_idx" ON "post_comment_likes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "post_comment_likes_commentId_userId_key" ON "post_comment_likes"("commentId", "userId");

-- CreateIndex
CREATE INDEX "media_ownerUserId_idx" ON "media"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "pets_profilePicId_key" ON "pets"("profilePicId");

-- CreateIndex
CREATE UNIQUE INDEX "pets_microchipNumber_key" ON "pets"("microchipNumber");

-- CreateIndex
CREATE INDEX "pet_family_members_petId_idx" ON "pet_family_members"("petId");

-- CreateIndex
CREATE UNIQUE INDEX "vaccine_types_name_key" ON "vaccine_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_wallets_userId_key" ON "user_wallets"("userId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_idx" ON "wallet_transactions"("walletId");

-- CreateIndex
CREATE INDEX "wallet_transactions_sourceType_sourceId_idx" ON "wallet_transactions"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_walletId_createdAt_idx" ON "wallet_withdraw_requests"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_userId_createdAt_idx" ON "wallet_withdraw_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_status_createdAt_idx" ON "wallet_withdraw_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_adminUserId_idx" ON "wallet_withdraw_requests"("adminUserId");

-- CreateIndex
CREATE INDEX "wallet_withdraw_requests_provider_providerPayoutId_idx" ON "wallet_withdraw_requests"("provider", "providerPayoutId");

-- CreateIndex
CREATE INDEX "payout_event_logs_provider_providerEventId_idx" ON "payout_event_logs"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "payout_event_logs_provider_providerPayoutId_idx" ON "payout_event_logs"("provider", "providerPayoutId");

-- CreateIndex
CREATE INDEX "payout_event_logs_withdrawRequestId_idx" ON "payout_event_logs"("withdrawRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_updates_postId_key" ON "fundraising_updates"("postId");

-- CreateIndex
CREATE INDEX "fundraising_updates_campaignId_createdAt_idx" ON "fundraising_updates"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_accounts_userId_key" ON "fundraising_accounts"("userId");

-- CreateIndex
CREATE INDEX "fundraising_accounts_divisionId_idx" ON "fundraising_accounts"("divisionId");

-- CreateIndex
CREATE INDEX "fundraising_accounts_districtId_idx" ON "fundraising_accounts"("districtId");

-- CreateIndex
CREATE INDEX "fundraising_accounts_upazilaId_idx" ON "fundraising_accounts"("upazilaId");

-- CreateIndex
CREATE INDEX "fundraising_accounts_areaId_idx" ON "fundraising_accounts"("areaId");

-- CreateIndex
CREATE INDEX "fundraising_account_status_logs_accountId_createdAt_idx" ON "fundraising_account_status_logs"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "fundraising_account_status_logs_adminUserId_idx" ON "fundraising_account_status_logs"("adminUserId");

-- CreateIndex
CREATE INDEX "fundraising_verification_documents_accountId_idx" ON "fundraising_verification_documents"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_campaigns_postId_key" ON "fundraising_campaigns"("postId");

-- CreateIndex
CREATE INDEX "fundraising_campaigns_accountId_createdAt_idx" ON "fundraising_campaigns"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "donations_campaignId_createdAt_idx" ON "donations"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "donations_donorId_idx" ON "donations"("donorId");

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_payout_method_catalog_code_key" ON "fundraising_payout_method_catalog"("code");

-- CreateIndex
CREATE INDEX "fundraising_payout_method_catalog_isActive_idx" ON "fundraising_payout_method_catalog"("isActive");

-- CreateIndex
CREATE INDEX "fundraising_payout_methods_accountId_idx" ON "fundraising_payout_methods"("accountId");

-- CreateIndex
CREATE INDEX "fundraising_payout_methods_catalogId_idx" ON "fundraising_payout_methods"("catalogId");

-- CreateIndex
CREATE INDEX "fundraising_payout_methods_isDefault_idx" ON "fundraising_payout_methods"("isDefault");

-- CreateIndex
CREATE INDEX "fundraising_withdraw_requests_campaignId_createdAt_idx" ON "fundraising_withdraw_requests"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "fundraising_withdraw_requests_accountId_createdAt_idx" ON "fundraising_withdraw_requests"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "fundraising_withdraw_requests_status_createdAt_idx" ON "fundraising_withdraw_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "fundraising_withdraw_requests_adminUserId_idx" ON "fundraising_withdraw_requests"("adminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "fundraising_payout_transfer_logs_requestId_key" ON "fundraising_payout_transfer_logs"("requestId");

-- CreateIndex
CREATE INDEX "fundraising_payout_transfer_logs_proofMediaId_idx" ON "fundraising_payout_transfer_logs"("proofMediaId");

-- CreateIndex
CREATE INDEX "reports_type_targetId_idx" ON "reports"("type", "targetId");

-- CreateIndex
CREATE INDEX "reports_reporterId_idx" ON "reports"("reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "bd_divisions_code_key" ON "bd_divisions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bd_districts_code_key" ON "bd_districts"("code");

-- CreateIndex
CREATE INDEX "bd_districts_divisionId_idx" ON "bd_districts"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "bd_upazilas_code_key" ON "bd_upazilas"("code");

-- CreateIndex
CREATE INDEX "bd_upazilas_districtId_idx" ON "bd_upazilas"("districtId");

-- CreateIndex
CREATE UNIQUE INDEX "bd_areas_code_key" ON "bd_areas"("code");

-- CreateIndex
CREATE INDEX "bd_areas_upazilaId_idx" ON "bd_areas"("upazilaId");

-- CreateIndex
CREATE INDEX "bd_areas_districtId_idx" ON "bd_areas"("districtId");

-- CreateIndex
CREATE INDEX "bd_areas_parentId_idx" ON "bd_areas"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "bd_areas_parentId_nameEn_type_key" ON "bd_areas"("parentId", "nameEn", "type");

-- CreateIndex
CREATE UNIQUE INDEX "city_corporations_code_key" ON "city_corporations"("code");

-- CreateIndex
CREATE INDEX "areas_cityCorporationId_idx" ON "areas"("cityCorporationId");

-- CreateIndex
CREATE INDEX "areas_parentId_idx" ON "areas"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "areas_cityCorporationId_parentId_nameEn_key" ON "areas"("cityCorporationId", "parentId", "nameEn");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "partner_applications_userId_idx" ON "partner_applications"("userId");

-- CreateIndex
CREATE INDEX "organizations_ownerUserId_idx" ON "organizations"("ownerUserId");

-- CreateIndex
CREATE INDEX "branches_orgId_idx" ON "branches"("orgId");

-- CreateIndex
CREATE INDEX "BranchTypeOnBranch_branchTypeId_idx" ON "BranchTypeOnBranch"("branchTypeId");

-- CreateIndex
CREATE INDEX "branch_publish_requests_branchId_idx" ON "branch_publish_requests"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_types_code_key" ON "branch_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "organization_types_code_key" ON "organization_types"("code");

-- CreateIndex
CREATE INDEX "branch_to_types_typeId_idx" ON "branch_to_types"("typeId");

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
ALTER TABLE "user_profile_likes" ADD CONSTRAINT "user_profile_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profile_likes" ADD CONSTRAINT "user_profile_likes_likedById_fkey" FOREIGN KEY ("likedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_friend_requests" ADD CONSTRAINT "user_friend_requests_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_friend_requests" ADD CONSTRAINT "user_friend_requests_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_friends" ADD CONSTRAINT "user_friends_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_friends" ADD CONSTRAINT "user_friends_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "owner_profiles" ADD CONSTRAINT "owner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_kyc" ADD CONSTRAINT "owner_kyc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_kyc" ADD CONSTRAINT "owner_kyc_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_kyc_documents" ADD CONSTRAINT "owner_kyc_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_kyc_documents" ADD CONSTRAINT "owner_kyc_documents_ownerKycId_fkey" FOREIGN KEY ("ownerKycId") REFERENCES "owner_kyc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_legal_profiles" ADD CONSTRAINT "org_legal_profiles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_legal_profiles" ADD CONSTRAINT "org_legal_profiles_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_documents" ADD CONSTRAINT "org_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_documents" ADD CONSTRAINT "org_documents_orgLegalProfileId_fkey" FOREIGN KEY ("orgLegalProfileId") REFERENCES "org_legal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_directors" ADD CONSTRAINT "org_directors_nidFrontMediaId_fkey" FOREIGN KEY ("nidFrontMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_directors" ADD CONSTRAINT "org_directors_nidBackMediaId_fkey" FOREIGN KEY ("nidBackMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_directors" ADD CONSTRAINT "org_directors_signatureMediaId_fkey" FOREIGN KEY ("signatureMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_directors" ADD CONSTRAINT "org_directors_orgLegalProfileId_fkey" FOREIGN KEY ("orgLegalProfileId") REFERENCES "org_legal_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_profile_details" ADD CONSTRAINT "branch_profile_details_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_profile_details" ADD CONSTRAINT "branch_profile_details_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_documents" ADD CONSTRAINT "branch_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_documents" ADD CONSTRAINT "branch_documents_branchProfileId_fkey" FOREIGN KEY ("branchProfileId") REFERENCES "branch_profile_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_logs" ADD CONSTRAINT "verification_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "post_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comment_likes" ADD CONSTRAINT "post_comment_likes_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "post_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_comment_likes" ADD CONSTRAINT "post_comment_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_animalTypeId_fkey" FOREIGN KEY ("animalTypeId") REFERENCES "animal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "breeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_profilePicId_fkey" FOREIGN KEY ("profilePicId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_family_members" ADD CONSTRAINT "pet_family_members_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_family_members" ADD CONSTRAINT "pet_family_members_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "reward_histories" ADD CONSTRAINT "reward_histories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "user_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_withdraw_requests" ADD CONSTRAINT "wallet_withdraw_requests_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "user_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_withdraw_requests" ADD CONSTRAINT "wallet_withdraw_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_withdraw_requests" ADD CONSTRAINT "wallet_withdraw_requests_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_event_logs" ADD CONSTRAINT "payout_event_logs_withdrawRequestId_fkey" FOREIGN KEY ("withdrawRequestId") REFERENCES "wallet_withdraw_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_updates" ADD CONSTRAINT "fundraising_updates_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "fundraising_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_updates" ADD CONSTRAINT "fundraising_updates_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "bd_divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "bd_districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_upazilaId_fkey" FOREIGN KEY ("upazilaId") REFERENCES "bd_upazilas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_accounts" ADD CONSTRAINT "fundraising_accounts_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "bd_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_account_status_logs" ADD CONSTRAINT "fundraising_account_status_logs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_account_status_logs" ADD CONSTRAINT "fundraising_account_status_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_verification_documents" ADD CONSTRAINT "fundraising_verification_documents_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_verification_documents" ADD CONSTRAINT "fundraising_verification_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_campaigns" ADD CONSTRAINT "fundraising_campaigns_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_campaign_stats" ADD CONSTRAINT "fundraising_campaign_stats_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "fundraising_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "fundraising_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_payout_methods" ADD CONSTRAINT "fundraising_payout_methods_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_payout_methods" ADD CONSTRAINT "fundraising_payout_methods_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "fundraising_payout_method_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_withdraw_requests" ADD CONSTRAINT "fundraising_withdraw_requests_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "fundraising_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_withdraw_requests" ADD CONSTRAINT "fundraising_withdraw_requests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_withdraw_requests" ADD CONSTRAINT "fundraising_withdraw_requests_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "fundraising_payout_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_withdraw_requests" ADD CONSTRAINT "fundraising_withdraw_requests_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_payout_transfer_logs" ADD CONSTRAINT "fundraising_payout_transfer_logs_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "fundraising_withdraw_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fundraising_payout_transfer_logs" ADD CONSTRAINT "fundraising_payout_transfer_logs_proofMediaId_fkey" FOREIGN KEY ("proofMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bd_districts" ADD CONSTRAINT "bd_districts_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "bd_divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bd_upazilas" ADD CONSTRAINT "bd_upazilas_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "bd_districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bd_areas" ADD CONSTRAINT "bd_areas_upazilaId_fkey" FOREIGN KEY ("upazilaId") REFERENCES "bd_upazilas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bd_areas" ADD CONSTRAINT "bd_areas_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "bd_districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bd_areas" ADD CONSTRAINT "bd_areas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "bd_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_cityCorporationId_fkey" FOREIGN KEY ("cityCorporationId") REFERENCES "city_corporations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchTypeOnBranch" ADD CONSTRAINT "BranchTypeOnBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchTypeOnBranch" ADD CONSTRAINT "BranchTypeOnBranch_branchTypeId_fkey" FOREIGN KEY ("branchTypeId") REFERENCES "branch_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_publish_requests" ADD CONSTRAINT "branch_publish_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_to_types" ADD CONSTRAINT "branch_to_types_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_to_types" ADD CONSTRAINT "branch_to_types_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "branch_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
