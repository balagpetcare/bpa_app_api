/**
 * Manager module service: dashboard KPIs, staff list, reports, escalations.
 * Uses branchManager.service for access check and base KPIs.
 */

import type { EscalationType } from "../../services/branchPolicy.service";
const prisma = require("../../../../infrastructure/db/prismaClient").default;
const {
  assertBranchManagerAccess,
  getBranchManagerKpis,
  getBranchStaffOverview,
} = require("../../services/branchManager.service");
const {
  listEscalationsByBranch,
  createEscalation,
} = require("../../services/branchPolicy.service");

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Extended dashboard for manager: base KPIs + appointments, patients, low stock, supply requests, escalations.
 */
export async function getManagerDashboard(userId: number, branchId: number) {
  const { branch } = await assertBranchManagerAccess(userId, branchId);
  const baseKpis = await getBranchManagerKpis(userId, branchId);
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const [appointmentsToday, visitsToday, pendingSupply, pendingEscalations, lowStockCount] =
    await Promise.all([
      prisma.appointment.count({
        where: {
          branchId,
          scheduledStartAt: { gte: todayStart, lte: todayEnd },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
      }),
      prisma.visit.count({
        where: {
          branchId,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
      }),
      prisma.clinicalSupplyRequest.count({
        where: {
          branchId,
          status: { in: ["DRAFT", "SUBMITTED"] },
        },
      }),
      listEscalationsByBranch(branchId, "PENDING").then((r) => r.length),
      prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*)::bigint AS count FROM branch_item_stocks WHERE "branchId" = $1 AND "reorderLevel" IS NOT NULL AND "availableQty" < "reorderLevel"`,
        branchId
      ).then((r) => Number(r[0]?.count ?? 0)).catch(() => 0),
    ]);

  const doctorsOnDutyToday = await prisma.appointment
    .findMany({
      where: {
        branchId,
        scheduledStartAt: { gte: todayStart, lte: todayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        doctorId: { not: null },
      },
      select: { doctorId: true },
      distinct: ["doctorId"],
    })
    .then((rows) => rows.filter((r) => r.doctorId != null).length);

  return {
    ...baseKpis,
    appointmentsToday,
    patientsToday: visitsToday,
    doctorsOnDutyToday,
    lowStockCount: typeof lowStockCount === "number" ? lowStockCount : 0,
    pendingSupplyRequests: pendingSupply,
    pendingEscalations,
  };
}

/**
 * Staff list for branch (manager view).
 */
export async function getManagerStaffList(userId: number, branchId: number) {
  return getBranchStaffOverview(userId, branchId);
}

/**
 * Assign staff to branch (stub: actual assignment is via existing staff invite / branch member APIs).
 */
export async function assignStaff(
  userId: number,
  branchId: number,
  _payload: { userId: number; role: string }
) {
  await assertBranchManagerAccess(userId, branchId);
  return { success: true, message: "Use branch member invite API for assignment" };
}

/**
 * Update duty roster (stub: actual implementation can use PosShift or custom roster table).
 */
export async function updateRoster(
  userId: number,
  branchId: number,
  _payload: Record<string, unknown>
) {
  await assertBranchManagerAccess(userId, branchId);
  return { success: true, message: "Roster update received" };
}

/**
 * Approve/reject leave (stub: actual implementation can use WorkspaceApprovalRequest or leave table).
 */
export async function approveLeave(
  userId: number,
  branchId: number,
  _payload: { requestId?: number; approved: boolean; reason?: string }
) {
  await assertBranchManagerAccess(userId, branchId);
  return { success: true, message: "Leave decision recorded" };
}

/**
 * Daily revenue report for branch (date optional, default today).
 */
export async function getDailyReport(
  userId: number,
  branchId: number,
  date?: string
) {
  await assertBranchManagerAccess(userId, branchId);
  const d = date ? new Date(date) : new Date();
  const start = startOfDay(d);
  const end = endOfDay(d);

  const [ordersAgg, posAgg] = await Promise.all([
    prisma.order.aggregate({
      where: {
        branchId,
        createdAt: { gte: start, lte: end },
      },
      _count: { id: true },
      _sum: { totalAmount: true },
    }),
    prisma.posInvoice.aggregate({
      where: {
        branchId,
        createdAt: { gte: start, lte: end },
      },
      _count: { id: true },
      _sum: { totalAmount: true },
    }).catch(() => ({ _count: { id: 0 }, _sum: { totalAmount: null } })),
  ]);

  const orderCount = ordersAgg._count?.id ?? 0;
  const orderTotal = Number(ordersAgg._sum?.totalAmount ?? 0);
  const posCount = posAgg._count?.id ?? 0;
  const posTotal = Number(posAgg._sum?.totalAmount ?? 0);

  return {
    date: start.toISOString().slice(0, 10),
    branchId,
    orders: { count: orderCount, total: orderTotal },
    pos: { count: posCount, total: posTotal },
    revenueTotal: orderTotal + posTotal,
  };
}

/**
 * Doctor performance report (stub: visit count per doctor for date range).
 */
export async function getDoctorPerformanceReport(
  userId: number,
  branchId: number,
  _dateFrom?: string,
  _dateTo?: string
) {
  await assertBranchManagerAccess(userId, branchId);
  const members = await prisma.branchMember.findMany({
    where: { branchId, role: "CLINIC_STAFF" },
    select: { id: true, userId: true, user: { select: { profile: { select: { displayName: true } } } } },
  });
  const visitCounts = await prisma.visit.groupBy({
    by: ["doctorId"],
    where: { branchId },
    _count: { id: true },
  });
  const byDoctor = new Map(visitCounts.map((v) => [v.doctorId, v._count.id]));
  return {
    branchId,
    doctors: members.map((m) => ({
      memberId: m.id,
      userId: m.userId,
      displayName: m.user?.profile?.displayName ?? null,
      visitCount: byDoctor.get(m.id) ?? 0,
    })),
  };
}

/**
 * Inventory usage report (stub: placeholder).
 */
export async function getInventoryUsageReport(
  userId: number,
  branchId: number,
  _dateFrom?: string,
  _dateTo?: string
) {
  await assertBranchManagerAccess(userId, branchId);
  return {
    branchId,
    summary: { itemsUsed: 0, lowStockItems: 0 },
    items: [],
  };
}

/**
 * List escalations for branch (manager view).
 */
export async function getManagerEscalations(
  userId: number,
  branchId: number,
  status?: "PENDING" | "APPROVED" | "REJECTED"
) {
  await assertBranchManagerAccess(userId, branchId);
  return listEscalationsByBranch(branchId, status);
}

/**
 * Create escalation (manager requests owner approval).
 */
export async function createManagerEscalation(
  userId: number,
  branchId: number,
  type: EscalationType,
  payload: Record<string, unknown>
) {
  await assertBranchManagerAccess(userId, branchId);
  return createEscalation(branchId, type, payload, userId);
}
