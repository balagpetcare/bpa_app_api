-- AlterTable
ALTER TABLE "fundraising_accounts" ADD COLUMN     "birthRegNumber" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "nationalIdNumber" TEXT,
ADD COLUMN     "studentIdNumber" TEXT;
