-- AlterTable
ALTER TABLE "branches" ADD COLUMN "clinicSettingsJson" JSONB NOT NULL DEFAULT '{}';
