-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_QUEUE', 'CALLED', 'IN_CONSULT', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('MOBILE', 'OWNER_PORTAL', 'WALKIN', 'STAFF');

-- CreateEnum
CREATE TYPE "AppointmentPriority" AS ENUM ('NORMAL', 'EMERGENCY', 'VIP');

-- CreateEnum
CREATE TYPE "QueueSessionStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QueueSessionType" AS ENUM ('GENERAL', 'DOCTOR_SPECIFIC', 'SERVICE_SPECIFIC');

-- CreateEnum
CREATE TYPE "QueueTicketStatus" AS ENUM ('CREATED', 'WAITING', 'CALLED', 'SKIPPED', 'IN_SERVICE', 'DONE', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "QueueTicketPriority" AS ENUM ('NORMAL', 'EMERGENCY', 'FOLLOWUP');

-- CreateEnum
CREATE TYPE "DoctorScheduleExceptionType" AS ENUM ('OFF', 'EXTRA_SHIFT', 'CUSTOM_SLOTS');

-- CreateTable
CREATE TABLE "appointments" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "petId" INTEGER,
    "doctorId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "scheduledStartAt" TIMESTAMP(3) NOT NULL,
    "scheduledEndAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "AppointmentSource" NOT NULL DEFAULT 'STAFF',
    "priority" "AppointmentPriority" NOT NULL DEFAULT 'NORMAL',
    "notes" TEXT,
    "channelMeta" JSONB,
    "cancellationReason" VARCHAR(256),
    "cancelledByUserId" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "rescheduleFromAppointmentId" INTEGER,
    "noShowMarkedByUserId" INTEGER,
    "noShowAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" SERIAL NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "byUserId" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedule_exceptions" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "type" "DoctorScheduleExceptionType" NOT NULL,
    "startTime" VARCHAR(5),
    "endTime" VARCHAR(5),
    "note" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_locks" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "lockOwnerUserId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slot_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_sessions" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "type" "QueueSessionType" NOT NULL DEFAULT 'GENERAL',
    "status" "QueueSessionStatus" NOT NULL DEFAULT 'OPEN',
    "lastTokenSeq" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_tickets" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "queueSessionId" INTEGER NOT NULL,
    "tokenNo" VARCHAR(16) NOT NULL,
    "appointmentId" INTEGER,
    "patientId" INTEGER,
    "petId" INTEGER,
    "doctorId" INTEGER,
    "priorityScore" INTEGER NOT NULL DEFAULT 0,
    "priorityTag" "QueueTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "QueueTicketStatus" NOT NULL DEFAULT 'CREATED',
    "estimatedCallAt" TIMESTAMP(3),
    "checkInAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_events" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "byUserId" INTEGER,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointments_doctorId_scheduledStartAt_scheduledEndAt_key" ON "appointments"("doctorId", "scheduledStartAt", "scheduledEndAt");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_rescheduleFromAppointmentId_key" ON "appointments"("rescheduleFromAppointmentId");

-- CreateIndex
CREATE INDEX "appointments_orgId_branchId_idx" ON "appointments"("orgId", "branchId");

-- CreateIndex
CREATE INDEX "appointments_branchId_status_idx" ON "appointments"("branchId", "status");

-- CreateIndex
CREATE INDEX "appointments_patientId_idx" ON "appointments"("patientId");

-- CreateIndex
CREATE INDEX "appointments_scheduledStartAt_idx" ON "appointments"("scheduledStartAt");

-- CreateIndex
CREATE INDEX "appointment_events_appointmentId_idx" ON "appointment_events"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_schedule_exceptions_doctorId_date_type_key" ON "doctor_schedule_exceptions"("doctorId", "date", "type");

-- CreateIndex
CREATE INDEX "doctor_schedule_exceptions_orgId_branchId_idx" ON "doctor_schedule_exceptions"("orgId", "branchId");

-- CreateIndex
CREATE INDEX "doctor_schedule_exceptions_branchId_date_idx" ON "doctor_schedule_exceptions"("branchId", "date");

-- CreateIndex
CREATE INDEX "slot_locks_orgId_branchId_idx" ON "slot_locks"("orgId", "branchId");

-- CreateIndex
CREATE INDEX "slot_locks_branchId_doctorId_idx" ON "slot_locks"("branchId", "doctorId");

-- CreateIndex
CREATE INDEX "slot_locks_expiresAt_idx" ON "slot_locks"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "queue_sessions_branchId_date_type_key" ON "queue_sessions"("branchId", "date", "type");

-- CreateIndex
CREATE INDEX "queue_sessions_orgId_branchId_idx" ON "queue_sessions"("orgId", "branchId");

-- CreateIndex
CREATE INDEX "queue_sessions_branchId_date_idx" ON "queue_sessions"("branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tickets_branchId_queueSessionId_tokenNo_key" ON "queue_tickets"("branchId", "queueSessionId", "tokenNo");

-- CreateIndex
CREATE INDEX "queue_tickets_orgId_branchId_idx" ON "queue_tickets"("orgId", "branchId");

-- CreateIndex
CREATE INDEX "queue_tickets_queueSessionId_status_idx" ON "queue_tickets"("queueSessionId", "status");

-- CreateIndex
CREATE INDEX "queue_tickets_branchId_idx" ON "queue_tickets"("branchId");

-- CreateIndex
CREATE INDEX "queue_events_ticketId_idx" ON "queue_events"("ticketId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "branch_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduleFromAppointmentId_fkey" FOREIGN KEY ("rescheduleFromAppointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_exceptions" ADD CONSTRAINT "doctor_schedule_exceptions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_exceptions" ADD CONSTRAINT "doctor_schedule_exceptions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule_exceptions" ADD CONSTRAINT "doctor_schedule_exceptions_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_locks" ADD CONSTRAINT "slot_locks_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_locks" ADD CONSTRAINT "slot_locks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_locks" ADD CONSTRAINT "slot_locks_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "branch_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_sessions" ADD CONSTRAINT "queue_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_sessions" ADD CONSTRAINT "queue_sessions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_queueSessionId_fkey" FOREIGN KEY ("queueSessionId") REFERENCES "queue_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "branch_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "queue_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend AuditEntityType enum for clinic audit (run once; re-run may error if values exist)
ALTER TYPE "AuditEntityType" ADD VALUE 'APPOINTMENT';
ALTER TYPE "AuditEntityType" ADD VALUE 'QUEUE_SESSION';
ALTER TYPE "AuditEntityType" ADD VALUE 'QUEUE_TICKET';
