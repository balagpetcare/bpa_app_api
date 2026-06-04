-- Centralized Bangladesh Location System (additive, non-destructive)

-- 1) Union master table
CREATE TABLE "bd_unions" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameBn" TEXT,
  "upazilaId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "latitude" DECIMAL(10,8),
  "longitude" DECIMAL(11,8),
  CONSTRAINT "bd_unions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bd_unions_code_key" ON "bd_unions"("code");
CREATE INDEX "bd_unions_upazilaId_idx" ON "bd_unions"("upazilaId");

ALTER TABLE "bd_unions"
  ADD CONSTRAINT "bd_unions_upazilaId_fkey"
  FOREIGN KEY ("upazilaId") REFERENCES "bd_upazilas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Extend bd_areas with explicit union reference
ALTER TABLE "bd_areas" ADD COLUMN "unionId" INTEGER;
CREATE INDEX "bd_areas_unionId_idx" ON "bd_areas"("unionId");
ALTER TABLE "bd_areas"
  ADD CONSTRAINT "bd_areas_unionId_fkey"
  FOREIGN KEY ("unionId") REFERENCES "bd_unions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Add centralized location refs to user/owner/org/branch/doctor/staff/producer models
ALTER TABLE "user_profiles"
  ADD COLUMN "divisionId" INTEGER,
  ADD COLUMN "districtId" INTEGER,
  ADD COLUMN "upazilaId" INTEGER,
  ADD COLUMN "unionId" INTEGER,
  ADD COLUMN "areaId" INTEGER;
CREATE INDEX "user_profiles_divisionId_idx" ON "user_profiles"("divisionId");
CREATE INDEX "user_profiles_districtId_idx" ON "user_profiles"("districtId");
CREATE INDEX "user_profiles_upazilaId_idx" ON "user_profiles"("upazilaId");
CREATE INDEX "user_profiles_unionId_idx" ON "user_profiles"("unionId");
CREATE INDEX "user_profiles_areaId_idx" ON "user_profiles"("areaId");

ALTER TABLE "owner_profiles" ADD COLUMN "unionId" INTEGER;
CREATE INDEX "owner_profiles_unionId_idx" ON "owner_profiles"("unionId");

ALTER TABLE "organizations"
  ADD COLUMN "divisionId" INTEGER,
  ADD COLUMN "districtId" INTEGER,
  ADD COLUMN "upazilaId" INTEGER,
  ADD COLUMN "unionId" INTEGER,
  ADD COLUMN "areaId" INTEGER;
CREATE INDEX "organizations_divisionId_idx" ON "organizations"("divisionId");
CREATE INDEX "organizations_districtId_idx" ON "organizations"("districtId");
CREATE INDEX "organizations_upazilaId_idx" ON "organizations"("upazilaId");
CREATE INDEX "organizations_unionId_idx" ON "organizations"("unionId");
CREATE INDEX "organizations_areaId_idx" ON "organizations"("areaId");

ALTER TABLE "branches"
  ADD COLUMN "divisionId" INTEGER,
  ADD COLUMN "districtId" INTEGER,
  ADD COLUMN "upazilaId" INTEGER,
  ADD COLUMN "unionId" INTEGER,
  ADD COLUMN "areaId" INTEGER;
CREATE INDEX "branches_divisionId_idx" ON "branches"("divisionId");
CREATE INDEX "branches_districtId_idx" ON "branches"("districtId");
CREATE INDEX "branches_upazilaId_idx" ON "branches"("upazilaId");
CREATE INDEX "branches_unionId_idx" ON "branches"("unionId");
CREATE INDEX "branches_areaId_idx" ON "branches"("areaId");

ALTER TABLE "doctor_verifications"
  ADD COLUMN "divisionId" INTEGER,
  ADD COLUMN "districtId" INTEGER,
  ADD COLUMN "upazilaId" INTEGER,
  ADD COLUMN "unionId" INTEGER,
  ADD COLUMN "areaId" INTEGER;
CREATE INDEX "doctor_verifications_divisionId_idx" ON "doctor_verifications"("divisionId");
CREATE INDEX "doctor_verifications_districtId_idx" ON "doctor_verifications"("districtId");
CREATE INDEX "doctor_verifications_upazilaId_idx" ON "doctor_verifications"("upazilaId");
CREATE INDEX "doctor_verifications_unionId_idx" ON "doctor_verifications"("unionId");
CREATE INDEX "doctor_verifications_areaId_idx" ON "doctor_verifications"("areaId");

ALTER TABLE "staff_invites"
  ADD COLUMN "divisionId" INTEGER,
  ADD COLUMN "districtId" INTEGER,
  ADD COLUMN "upazilaId" INTEGER,
  ADD COLUMN "unionId" INTEGER,
  ADD COLUMN "areaId" INTEGER;
CREATE INDEX "staff_invites_divisionId_idx" ON "staff_invites"("divisionId");
CREATE INDEX "staff_invites_districtId_idx" ON "staff_invites"("districtId");
CREATE INDEX "staff_invites_upazilaId_idx" ON "staff_invites"("upazilaId");
CREATE INDEX "staff_invites_unionId_idx" ON "staff_invites"("unionId");
CREATE INDEX "staff_invites_areaId_idx" ON "staff_invites"("areaId");

ALTER TABLE "producer_orgs"
  ADD COLUMN "divisionId" INTEGER,
  ADD COLUMN "districtId" INTEGER,
  ADD COLUMN "upazilaId" INTEGER,
  ADD COLUMN "unionId" INTEGER,
  ADD COLUMN "areaId" INTEGER;
CREATE INDEX "producer_orgs_divisionId_idx" ON "producer_orgs"("divisionId");
CREATE INDEX "producer_orgs_districtId_idx" ON "producer_orgs"("districtId");
CREATE INDEX "producer_orgs_upazilaId_idx" ON "producer_orgs"("upazilaId");
CREATE INDEX "producer_orgs_unionId_idx" ON "producer_orgs"("unionId");
CREATE INDEX "producer_orgs_areaId_idx" ON "producer_orgs"("areaId");

ALTER TABLE "producer_factories"
  ADD COLUMN "divisionId" INTEGER,
  ADD COLUMN "districtId" INTEGER,
  ADD COLUMN "upazilaId" INTEGER,
  ADD COLUMN "unionId" INTEGER,
  ADD COLUMN "areaId" INTEGER;
CREATE INDEX "producer_factories_divisionId_idx" ON "producer_factories"("divisionId");
CREATE INDEX "producer_factories_districtId_idx" ON "producer_factories"("districtId");
CREATE INDEX "producer_factories_upazilaId_idx" ON "producer_factories"("upazilaId");
CREATE INDEX "producer_factories_unionId_idx" ON "producer_factories"("unionId");
CREATE INDEX "producer_factories_areaId_idx" ON "producer_factories"("areaId");

-- 4) Coverage assignments over centralized tables
CREATE TYPE "LocationCoverageEntityType" AS ENUM (
  'USER',
  'STAFF',
  'DOCTOR',
  'CLINIC',
  'SHOP',
  'BRANCH',
  'ORGANIZATION',
  'BREEDER',
  'PRODUCER',
  'VOLUNTEER',
  'RESCUE_TEAM'
);

CREATE TABLE "location_coverage_assignments" (
  "id" SERIAL NOT NULL,
  "entityType" "LocationCoverageEntityType" NOT NULL,
  "entityId" INTEGER NOT NULL,
  "divisionId" INTEGER,
  "districtId" INTEGER,
  "upazilaId" INTEGER,
  "unionId" INTEGER,
  "areaId" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_coverage_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "location_coverage_assignment_unique"
  ON "location_coverage_assignments"("entityType", "entityId", "divisionId", "districtId", "upazilaId", "unionId", "areaId");
CREATE INDEX "location_coverage_assignment_lookup"
  ON "location_coverage_assignments"("entityType", "entityId", "isActive");
CREATE INDEX "location_coverage_assignment_division_idx" ON "location_coverage_assignments"("divisionId");
CREATE INDEX "location_coverage_assignment_district_idx" ON "location_coverage_assignments"("districtId");
CREATE INDEX "location_coverage_assignment_upazila_idx" ON "location_coverage_assignments"("upazilaId");
CREATE INDEX "location_coverage_assignment_union_idx" ON "location_coverage_assignments"("unionId");
CREATE INDEX "location_coverage_assignment_area_idx" ON "location_coverage_assignments"("areaId");
