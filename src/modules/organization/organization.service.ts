import { prisma } from "../../lib/prisma";

export async function getOrganizationBySlug(slug: string) {
  return prisma.organization.findUnique({ where: { slug } });
}

export async function listOrganizations() {
  return prisma.organization.findMany({ orderBy: { id: "desc" } });
}