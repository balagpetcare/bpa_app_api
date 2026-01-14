import { prisma } from "../../lib/prisma";

export async function listPermissions() {
  return prisma.permission.findMany({ orderBy: { key: "asc" } });
}