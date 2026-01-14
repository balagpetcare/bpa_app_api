import { prisma } from "../../lib/prisma";

const VALID = new Set(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]);

export async function list(status?: string) {
  const where: any = {};
  if (status) {
    if (!VALID.has(status)) {
      const e: any = new Error("Invalid status filter");
      e.statusCode = 400;
      throw e;
    }
    where.status = status;
  }
  return prisma.partnerApplication.findMany({
    where,
    orderBy: { id: "desc" },
    include: { applicant: true, organization: true, branch: true },
  });
}

export async function markUnderReview(adminId: number, id: number) {
  const item = await prisma.partnerApplication.findUnique({ where: { id } });
  if (!item) {
    const e: any = new Error("Not found");
    e.statusCode = 404;
    throw e;
  }
  if (item.status != "SUBMITTED") {
    const e: any = new Error("Only SUBMITTED can be moved to UNDER_REVIEW");
    e.statusCode = 400;
    throw e;
  }

  return prisma.partnerApplication.update({
    where: { id },
    data: { status: "UNDER_REVIEW", reviewedById: adminId, reviewedAt: new Date() },
  });
}

export async function reject(adminId: number, id: number, reason: string) {
  const item = await prisma.partnerApplication.findUnique({ where: { id } });
  if (!item) {
    const e: any = new Error("Not found");
    e.statusCode = 404;
    throw e;
  }
  if (item.status === "APPROVED") {
    const e: any = new Error("Cannot reject an APPROVED application");
    e.statusCode = 400;
    throw e;
  }

  return prisma.partnerApplication.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedById: adminId,
      reviewedAt: new Date(),
      decisionReason: reason,
    },
  });
}

export async function approve(adminId: number, id: number) {
  const app = await prisma.partnerApplication.findUnique({ where: { id } });
  if (!app) {
    const e: any = new Error("Not found");
    e.statusCode = 404;
    throw e;
  }
  if (!(app.status === "SUBMITTED" || app.status === "UNDER_REVIEW")) {
    const e: any = new Error("Only SUBMITTED/UNDER_REVIEW can be approved");
    e.statusCode = 400;
    throw e;
  }

  if (app.organizationId && app.branchId) {
    return prisma.partnerApplication.update({
      where: { id: app.id },
      data: { status: "APPROVED", reviewedById: adminId, reviewedAt: new Date() },
    });
  }

  return prisma.$transaction(async (tx) => {
    const org = await (tx as any).organization.create({
      data: {
        name: app.orgName || "Unnamed Organization",
        // If your Organization model does NOT have ownerUserId, remove this line in your project.
        ownerUserId: app.applicantId,
      },
    });

    const branchName =
      app.businessType === "CLINIC"
        ? "Main Clinic"
        : app.businessType === "PET_SHOP"
        ? "Main Shop"
        : "Main Branch";

    const branch = await (tx as any).branch.create({
      data: { organizationId: org.id, name: branchName },
    });

    // OPTIONAL_ROLE_ASSIGNMENT (safe)
    try {
      if ((tx as any).role && (tx as any).userRole) {
        const role = await (tx as any).role.upsert({
          where: { key: "ORG_OWNER" },
          create: { key: "ORG_OWNER", name: "Organization Owner" },
          update: {},
        });

        await (tx as any).userRole.upsert({
          where: {
            userId_roleId_organizationId: {
              userId: app.applicantId,
              roleId: role.id,
              organizationId: org.id,
            },
          },
          create: {
            userId: app.applicantId,
            roleId: role.id,
            organizationId: org.id,
            status: "ACTIVE",
          },
          update: { status: "ACTIVE" },
        });
      }
    } catch {
      // ignore if schema doesn't match yet
    }

    return (tx as any).partnerApplication.update({
      where: { id: app.id },
      data: {
        status: "APPROVED",
        reviewedById: adminId,
        reviewedAt: new Date(),
        organizationId: org.id,
        branchId: branch.id,
      },
    });
  });
}
