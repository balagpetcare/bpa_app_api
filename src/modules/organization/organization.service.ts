import { prisma } from "../../lib/prisma";

export async function getOrganizationBySlug(slug: string) {
  // Current schema does not have a dedicated slug field; fall back to name match.
  return prisma.organization.findFirst({ where: { name: slug } });
}

export async function listOrganizations() {
  return prisma.organization.findMany({ orderBy: { id: "desc" as const } });
}
