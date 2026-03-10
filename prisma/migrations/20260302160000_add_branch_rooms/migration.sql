-- CreateTable
CREATE TABLE "branch_rooms" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "roomType" VARCHAR(32) NOT NULL,
    "capacity" INTEGER,
    "status" VARCHAR(16) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_rooms_branchId_name_key" ON "branch_rooms"("branchId", "name");

-- CreateIndex
CREATE INDEX "branch_rooms_orgId_branchId_idx" ON "branch_rooms"("orgId", "branchId");

-- CreateIndex
CREATE INDEX "branch_rooms_branchId_status_idx" ON "branch_rooms"("branchId", "status");

-- AddForeignKey
ALTER TABLE "branch_rooms" ADD CONSTRAINT "branch_rooms_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_rooms" ADD CONSTRAINT "branch_rooms_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
