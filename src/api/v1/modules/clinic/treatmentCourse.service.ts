/**
 * Treatment Course Service (CCMLPA) — multi-day injection courses and dose tracking.
 * Extended for Internal Order + Vial Activation Workflow: day-wise schedule, revisions, hold/stop.
 */
import type { Prisma } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";

export type CreateCourseInput = {
  patientId: number;
  visitId?: number | null;
  variantId: number;
  totalPrescribedDoses: number;
  expectedDates?: string[] | null; // ISO date strings
};

export type TreatmentDayItemInput = {
  variantId: number;
  medicineName: string;
  dosageMl: number;
  route?: string | null;
  frequency?: string | null;
  expectedNote?: string | null;
};

export type TreatmentDayInput = {
  dayNumber: number;
  scheduledDate: Date;
  items: TreatmentDayItemInput[];
};

export type CreateFullCourseInput = {
  patientId: number;
  visitId?: number | null;
  branchId?: number | null;
  prescribedByDoctorId?: number | null;
  treatmentBranchId?: number | null;
  crossBranchAllowed?: boolean;
  durationDays: number;
  days: TreatmentDayInput[];
  createdByUserId: number; // for first revision
};

export async function createCourse(data: CreateCourseInput): Promise<any> {
  return prisma.treatmentCourse.create({
    data: {
      patientId: data.patientId,
      visitId: data.visitId ?? null,
      variantId: data.variantId,
      totalPrescribedDoses: data.totalPrescribedDoses,
      expectedDatesJson: data.expectedDates ?? null,
      status: "ACTIVE",
    },
    include: { variant: { select: { id: true, title: true } } },
  });
}

/** Create course + day-wise schedule + day items + initial revision in one transaction. */
export async function createFullCourse(data: CreateFullCourseInput): Promise<any> {
  const variantId = data.days[0]?.items[0]?.variantId ?? 0;
  const totalPrescribedDoses = data.days.reduce((sum, d) => sum + d.items.length, 0);
  const created = await prisma.$transaction(async (tx) => {
    const course = await (tx as any).treatmentCourse.create({
      data: {
        patientId: data.patientId,
        visitId: data.visitId ?? null,
        variantId,
        totalPrescribedDoses,
        status: "ACTIVE",
        branchId: data.branchId ?? null,
        prescribedByDoctorId: data.prescribedByDoctorId ?? null,
        durationDays: data.durationDays,
        crossBranchAllowed: data.crossBranchAllowed ?? false,
        treatmentBranchId: data.treatmentBranchId ?? null,
      },
    });
    for (const day of data.days) {
      const treatmentDay = await (tx as any).treatmentDay.create({
        data: {
          courseId: course.id,
          dayNumber: day.dayNumber,
          scheduledDate: day.scheduledDate,
          status: "PENDING",
        },
      });
      for (const item of day.items) {
        await (tx as any).treatmentDayItem.create({
          data: {
            treatmentDayId: treatmentDay.id,
            variantId: item.variantId,
            medicineName: item.medicineName,
            dosageMl: item.dosageMl,
            route: item.route ?? null,
            frequency: item.frequency ?? null,
            expectedNote: item.expectedNote ?? null,
            status: "DUE",
          },
        });
      }
    }
    await (tx as any).treatmentRevision.create({
      data: {
        courseId: course.id,
        revisionNumber: 1,
        changedByUserId: data.createdByUserId,
        changeType: "DAY_MODIFIED",
        changeDetails: { action: "CREATED", durationDays: data.durationDays },
      },
    });
    return course;
  });
  return getCourseWithSchedule(created.id);
}

/** List treatment courses for a branch (prescription or treatment branch), optionally by patient. */
export async function listCourses(
  branchId: number,
  opts?: { patientId?: number; status?: string; skip?: number; take?: number }
): Promise<{ list: any[]; total: number }> {
  const where: any = {
    OR: [{ branchId }, { treatmentBranchId: branchId }],
  };
  if (opts?.patientId != null) where.patientId = opts.patientId;
  if (opts?.status) where.status = opts.status;
  const [list, total] = await Promise.all([
    prisma.treatmentCourse.findMany({
      where,
      skip: opts?.skip ?? 0,
      take: Math.min(opts?.take ?? 50, 100),
      orderBy: { updatedAt: "desc" },
      include: {
        patient: { select: { id: true, profile: { select: { displayName: true } } } },
        variant: { select: { id: true, title: true } },
        prescriptionBranch: { select: { id: true, name: true } },
        treatmentBranch: { select: { id: true, name: true } },
        _count: { select: { days: true } },
      },
    }),
    prisma.treatmentCourse.count({ where }),
  ]);
  return { list, total };
}

/** Full course with all days and items (for detail view). */
export async function getCourseWithSchedule(courseId: number): Promise<any> {
  return prisma.treatmentCourse.findUnique({
    where: { id: courseId },
    include: {
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
      visit: { select: { id: true, treatmentCode: true } },
      variant: { select: { id: true, title: true, sku: true } },
      prescriptionBranch: { select: { id: true, name: true } },
      treatmentBranch: { select: { id: true, name: true } },
      prescribedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      doses: { orderBy: { administeredAt: "asc" } },
      days: {
        orderBy: { dayNumber: "asc" },
        include: {
          items: {
            include: { variant: { select: { id: true, title: true, sku: true } } },
          },
        },
      },
      revisions: { orderBy: { revisionNumber: "desc" }, take: 20 },
    },
  });
}

export type UpdateDayItemInput = {
  status?: "DUE" | "ADMINISTERED" | "SKIPPED" | "HELD";
  dosageMl?: number;
  route?: string | null;
  expectedNote?: string | null;
};

/** Update or hold/skip a specific day item. */
export async function updateDayItem(
  itemId: number,
  data: UpdateDayItemInput,
  changedByUserId: number
): Promise<any> {
  const item = await prisma.treatmentDayItem.findUnique({
    where: { id: itemId },
    include: { treatmentDay: { include: { course: true } } },
  });
  if (!item) throw new Error("Treatment day item not found");
  const course = item.treatmentDay.course;
  const updated = await prisma.treatmentDayItem.update({
    where: { id: itemId },
    data: {
      ...(data.status != null && { status: data.status }),
      ...(data.dosageMl != null && { dosageMl: data.dosageMl }),
      ...(data.route !== undefined && { route: data.route }),
      ...(data.expectedNote !== undefined && { expectedNote: data.expectedNote }),
    },
  });
  await addRevision(course.id, "DOSE_CHANGED", { itemId, updates: data }, changedByUserId);
  return updated;
}

/** Log a change to TreatmentRevision. */
export async function addRevision(
  courseId: number,
  changeType: "MEDICINE_ADDED" | "MEDICINE_REMOVED" | "DOSE_CHANGED" | "DAY_MODIFIED" | "HOLD" | "RESUME" | "STOP",
  changeDetails: Record<string, unknown> | null,
  changedByUserId: number
): Promise<any> {
  const count = await prisma.treatmentRevision.count({ where: { courseId } });
  return prisma.treatmentRevision.create({
    data: {
      courseId,
      revisionNumber: count + 1,
      changedByUserId,
      changeType,
      changeDetails: (changeDetails ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Get revision history for a course. */
export async function getRevisionHistory(courseId: number, limit = 50): Promise<any[]> {
  return prisma.treatmentRevision.findMany({
    where: { courseId },
    orderBy: { revisionNumber: "desc" },
    take: limit,
    include: {
      changedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
}

/** Hold course (status -> HOLD). */
export async function holdCourse(courseId: number, reason: string | null, changedByUserId: number): Promise<any> {
  const course = await prisma.treatmentCourse.findUnique({ where: { id: courseId } });
  if (!course) throw new Error("Course not found");
  if (course.status !== "ACTIVE") throw new Error("Course is not active");
  await addRevision(courseId, "HOLD", { reason }, changedByUserId);
  return prisma.treatmentCourse.update({
    where: { id: courseId },
    data: { status: "HOLD", holdReason: reason ?? undefined },
  });
}

/** Resume course (status -> ACTIVE). */
export async function resumeCourse(courseId: number, changedByUserId: number): Promise<any> {
  const course = await prisma.treatmentCourse.findUnique({ where: { id: courseId } });
  if (!course) throw new Error("Course not found");
  if (course.status !== "HOLD") throw new Error("Course is not on hold");
  await addRevision(courseId, "RESUME", {}, changedByUserId);
  return prisma.treatmentCourse.update({
    where: { id: courseId },
    data: { status: "ACTIVE", holdReason: null },
  });
}

/** Stop course (status -> STOPPED). */
export async function stopCourse(courseId: number, changedByUserId: number): Promise<any> {
  const course = await prisma.treatmentCourse.findUnique({ where: { id: courseId } });
  if (!course) throw new Error("Course not found");
  if (course.status !== "ACTIVE" && course.status !== "HOLD") throw new Error("Course cannot be stopped");
  await addRevision(courseId, "STOP", {}, changedByUserId);
  return prisma.treatmentCourse.update({
    where: { id: courseId },
    data: { status: "STOPPED", holdReason: null },
  });
}

export type RecordCourseDoseInput = {
  courseId: number;
  vialSessionId?: number | null;
  doseQty: number;
  administeredByUserId?: number | null;
};

export async function recordCourseDose(data: RecordCourseDoseInput): Promise<any> {
  const course = await prisma.treatmentCourse.findUnique({
    where: { id: data.courseId },
    include: { doses: true },
  });
  if (!course || course.status !== "ACTIVE") throw new Error("Course not found or not active");
  const givenCount = course.doses.length;
  if (givenCount >= course.totalPrescribedDoses) throw new Error("Course already completed");
  const dose = await prisma.treatmentCourseDose.create({
    data: {
      courseId: data.courseId,
      vialSessionId: data.vialSessionId ?? null,
      doseQty: data.doseQty,
      administeredByUserId: data.administeredByUserId ?? null,
    },
  });
  const newCount = givenCount + 1;
  const newStatus = newCount >= course.totalPrescribedDoses ? "COMPLETED" : "ACTIVE";
  await prisma.treatmentCourse.update({
    where: { id: data.courseId },
    data: { status: newStatus },
  });
  return prisma.treatmentCourse.findUnique({
    where: { id: data.courseId },
    include: { variant: true, doses: { orderBy: { administeredAt: "asc" } } },
  });
}

export async function getCourseProgress(courseId: number): Promise<{
  course: any;
  remainingDoses: number;
  completionPct: number;
}> {
  const course = await prisma.treatmentCourse.findUnique({
    where: { id: courseId },
    include: { variant: true, doses: true },
  });
  if (!course) throw new Error("Course not found");
  const remaining = Math.max(0, course.totalPrescribedDoses - course.doses.length);
  const completionPct = course.totalPrescribedDoses > 0
    ? Math.round((course.doses.length / course.totalPrescribedDoses) * 100)
    : 0;
  return { course, remainingDoses: remaining, completionPct };
}
