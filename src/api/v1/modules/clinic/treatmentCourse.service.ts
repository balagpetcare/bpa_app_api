/**
 * Treatment Course Service (CCMLPA) — multi-day injection courses and dose tracking.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

export type CreateCourseInput = {
  patientId: number;
  visitId?: number | null;
  variantId: number;
  totalPrescribedDoses: number;
  expectedDates?: string[] | null; // ISO date strings
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
