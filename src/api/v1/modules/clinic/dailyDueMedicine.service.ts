/**
 * Daily Due Medicine Engine — detect current treatment day and return today's due medicines.
 * Used by Smart Billing and Injection Token flow.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

const now = () => new Date();

/** Get today's date at start of day (UTC or local as per DB). */
function todayStart(): Date {
  const d = now();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Detect current treatment day for a course (first PENDING day with scheduledDate <= today)
 * and return due items for that day (excluding HELD).
 */
export async function getTodayDueMedicines(
  courseId: number,
  branchId: number
): Promise<{
  course: any;
  currentDay: any | null;
  todayDueItems: any[];
  expectedMedicineCount: number;
}> {
  const course = await prisma.treatmentCourse.findUnique({
    where: { id: courseId },
    include: {
      patient: { select: { id: true, profile: { select: { displayName: true } } } },
      prescriptionBranch: { select: { id: true, name: true } },
      treatmentBranch: { select: { id: true, name: true } },
      days: {
        orderBy: { dayNumber: "asc" },
        include: {
          items: {
            where: { status: { in: ["DUE", "ADMINISTERED"] } },
            include: { variant: { select: { id: true, title: true, sku: true } } },
          },
        },
      },
    },
  });
  if (!course) throw new Error("Treatment course not found");

  const effectiveBranchId = course.treatmentBranchId ?? course.branchId ?? branchId;
  if (course.treatmentBranchId != null && course.treatmentBranchId !== branchId && !course.crossBranchAllowed) {
    throw new Error("Cross-branch treatment not allowed for this course");
  }
  if (effectiveBranchId !== branchId && !course.crossBranchAllowed) {
    throw new Error("Treatment branch does not match");
  }

  const today = todayStart();
  const currentDay = course.days.find(
    (d) => d.status === "PENDING" && new Date(d.scheduledDate) <= today
  ) ?? course.days.find((d) => d.status === "PENDING");

  if (!currentDay) {
    return {
      course,
      currentDay: null,
      todayDueItems: [],
      expectedMedicineCount: 0,
    };
  }

  const todayDueItems = currentDay.items.filter((i) => i.status === "DUE");
  return {
    course,
    currentDay: {
      id: currentDay.id,
      dayNumber: currentDay.dayNumber,
      scheduledDate: currentDay.scheduledDate,
      status: currentDay.status,
      items: currentDay.items,
    },
    todayDueItems,
    expectedMedicineCount: todayDueItems.length,
  };
}

/**
 * Get all today's due medicines for a patient at a branch (all active courses aggregated).
 */
export async function getPatientDueMedicines(
  patientId: number,
  branchId: number
): Promise<{
  courses: any[];
  todayDueByCourse: { courseId: number; currentDay: any; items: any[] }[];
}> {
  const courses = await prisma.treatmentCourse.findMany({
    where: {
      patientId,
      status: { in: ["ACTIVE", "HOLD"] },
      OR: [
        { treatmentBranchId: branchId },
        { branchId },
        { treatmentBranchId: null, branchId: null },
      ],
    },
    include: {
      prescriptionBranch: { select: { id: true, name: true } },
      treatmentBranch: { select: { id: true, name: true } },
      days: {
        orderBy: { dayNumber: "asc" },
        include: {
          items: {
            where: { status: "DUE" },
            include: { variant: { select: { id: true, title: true, sku: true } } },
          },
        },
      },
    },
  });

  const today = todayStart();
  const todayDueByCourse: { courseId: number; currentDay: any; items: any[] }[] = [];

  for (const course of courses) {
    const effectiveBranchId = course.treatmentBranchId ?? course.branchId ?? branchId;
    if (effectiveBranchId !== branchId && !course.crossBranchAllowed) continue;

    const currentDay = course.days.find(
      (d) => d.status === "PENDING" && new Date(d.scheduledDate) <= today
    ) ?? course.days.find((d) => d.status === "PENDING");

    if (!currentDay) continue;

    const dueItems = currentDay.items.filter((i) => i.status === "DUE");
    if (dueItems.length > 0) {
      todayDueByCourse.push({
        courseId: course.id,
        currentDay: {
          id: currentDay.id,
          dayNumber: currentDay.dayNumber,
          scheduledDate: currentDay.scheduledDate,
          status: currentDay.status,
        },
        items: dueItems,
      });
    }
  }

  return { courses, todayDueByCourse };
}

/**
 * Mark a treatment day as completed (all items administered or skipped).
 * Optionally set status to COMPLETED and completedAt.
 */
export async function markDayCompleted(treatmentDayId: number): Promise<any> {
  const day = await prisma.treatmentDay.findUnique({
    where: { id: treatmentDayId },
    include: { items: true, course: true },
  });
  if (!day) throw new Error("Treatment day not found");

  const allDone = day.items.every(
    (i) => i.status === "ADMINISTERED" || i.status === "SKIPPED"
  );
  if (!allDone) {
    throw new Error("Not all items are administered or skipped");
  }

  const updated = await prisma.treatmentDay.update({
    where: { id: treatmentDayId },
    data: { status: "COMPLETED", completedAt: now() },
    include: {
      items: { include: { variant: { select: { id: true, title: true } } } },
      course: { select: { id: true, status: true, durationDays: true } },
    },
  });

  const completedDays = await prisma.treatmentDay.count({
    where: { courseId: day.courseId, status: "COMPLETED" },
  });
  if (day.course.durationDays != null && completedDays >= day.course.durationDays) {
    await prisma.treatmentCourse.update({
      where: { id: day.courseId },
      data: { status: "COMPLETED" },
    });
  }

  return updated;
}
