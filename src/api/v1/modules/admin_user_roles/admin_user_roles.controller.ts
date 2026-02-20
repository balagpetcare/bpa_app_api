/**
 * Phase 4: Admin API for Global + Country role assignments.
 */

import prisma from "../../../../infrastructure/db/prismaClient";

function parseId(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export async function listGlobalRoles(req: any, res: any) {
  try {
    const roles = await prisma.role.findMany({
      where: { scope: "GLOBAL" },
      orderBy: { key: "asc" },
      include: {
        rolePermissions: { include: { permission: { select: { id: true, key: true, label: true } } } },
      },
    });
    return res.json({ success: true, data: roles });
  } catch (e) {
    console.error("admin_user_roles.listGlobalRoles", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export async function listCountryRoles(req: any, res: any) {
  try {
    const roles = await prisma.role.findMany({
      where: { scope: "COUNTRY" },
      orderBy: { key: "asc" },
      include: {
        rolePermissions: { include: { permission: { select: { id: true, key: true, label: true } } } },
      },
    });
    return res.json({ success: true, data: roles });
  } catch (e) {
    console.error("admin_user_roles.listCountryRoles", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export async function listUserGlobalRoles(req: any, res: any) {
  try {
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid userId" });
    const list = await prisma.userGlobalRole.findMany({
      where: { userId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    return res.json({ success: true, data: list });
  } catch (e) {
    console.error("admin_user_roles.listUserGlobalRoles", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export async function assignUserGlobalRole(req: any, res: any) {
  try {
    const userId = parseId(req.params.userId);
    const roleId = parseId(req.body?.roleId);
    if (!userId || !roleId) return res.status(400).json({ success: false, message: "userId and roleId required" });
    const role = await prisma.role.findFirst({ where: { id: roleId, scope: "GLOBAL" } });
    if (!role) return res.status(404).json({ success: false, message: "Global role not found" });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await prisma.userGlobalRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
    const list = await prisma.userGlobalRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return res.status(201).json({ success: true, data: list });
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ success: false, message: "Already assigned" });
    console.error("admin_user_roles.assignUserGlobalRole", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export async function removeUserGlobalRole(req: any, res: any) {
  try {
    const userId = parseId(req.params.userId);
    const roleId = parseId(req.params.roleId);
    if (!userId || !roleId) return res.status(400).json({ success: false, message: "Invalid userId or roleId" });
    await prisma.userGlobalRole.deleteMany({ where: { userId, roleId } });
    return res.json({ success: true, message: "Removed" });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ success: false, message: "Assignment not found" });
    console.error("admin_user_roles.removeUserGlobalRole", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export async function listUserCountryRoles(req: any, res: any) {
  try {
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ success: false, message: "Invalid userId" });
    const list = await prisma.userCountryRole.findMany({
      where: { userId },
      include: { role: true, country: { select: { id: true, code: true, name: true } } },
    });
    return res.json({ success: true, data: list });
  } catch (e) {
    console.error("admin_user_roles.listUserCountryRoles", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export async function assignUserCountryRole(req: any, res: any) {
  try {
    const userId = parseId(req.params.userId);
    const roleId = parseId(req.body?.roleId);
    const countryId = parseId(req.body?.countryId);
    if (!userId || !roleId || !countryId)
      return res.status(400).json({ success: false, message: "userId, roleId and countryId required" });
    const role = await prisma.role.findFirst({ where: { id: roleId, scope: "COUNTRY" } });
    if (!role) return res.status(404).json({ success: false, message: "Country role not found" });
    const country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country) return res.status(404).json({ success: false, message: "Country not found" });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await prisma.userCountryRole.upsert({
      where: { userId_countryId_roleId: { userId, countryId, roleId } },
      update: {},
      create: { userId, countryId, roleId },
    });
    const list = await prisma.userCountryRole.findMany({
      where: { userId },
      include: { role: true, country: { select: { id: true, code: true, name: true } } },
    });
    return res.status(201).json({ success: true, data: list });
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ success: false, message: "Already assigned" });
    console.error("admin_user_roles.assignUserCountryRole", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export async function removeUserCountryRole(req: any, res: any) {
  try {
    const userId = parseId(req.params.userId);
    const countryId = parseId(req.params.countryId);
    const roleId = parseId(req.params.roleId);
    if (!userId || !countryId || !roleId)
      return res.status(400).json({ success: false, message: "Invalid userId, countryId or roleId" });
    await prisma.userCountryRole.deleteMany({ where: { userId, countryId, roleId } });
    return res.json({ success: true, message: "Removed" });
  } catch (e: any) {
    if (e.code === "P2025") return res.status(404).json({ success: false, message: "Assignment not found" });
    console.error("admin_user_roles.removeUserCountryRole", e);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
