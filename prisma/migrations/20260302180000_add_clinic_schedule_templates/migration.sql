-- CreateTable
CREATE TABLE "doctor_schedule_templates" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "branchMemberId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 15,
    "maxSlots" INTEGER,
    "roomTypeRequired" VARCHAR(32),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_schedule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_schedule_templates" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "branchRoomId" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_schedule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_schedule_templates_branchId_branchMemberId_dayOfWeek_idx" ON "doctor_schedule_templates"("branchId", "branchMemberId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "doctor_schedule_templates_branchId_dayOfWeek_idx" ON "doctor_schedule_templates"("branchId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "room_schedule_templates_branchId_branchRoomId_dayOfWeek_idx" ON "room_schedule_templates"("branchId", "branchRoomId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "doctor_schedule_templates" ADD CONSTRAINT "doctor_schedule_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_templates" ADD CONSTRAINT "doctor_schedule_templates_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_templates" ADD CONSTRAINT "doctor_schedule_templates_branchMemberId_fkey" FOREIGN KEY ("branchMemberId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_schedule_templates" ADD CONSTRAINT "room_schedule_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_schedule_templates" ADD CONSTRAINT "room_schedule_templates_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_schedule_templates" ADD CONSTRAINT "room_schedule_templates_branchRoomId_fkey" FOREIGN KEY ("branchRoomId") REFERENCES "branch_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
