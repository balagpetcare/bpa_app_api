/**
 * Workspace Service – task, alert, approval CRUD with role/branch scope.
 * Owner: org-scoped. Manager: branch-scoped. Staff: self (assigned tasks only).
 */

const prisma = require("../../../../infrastructure/db/prismaClient").default;
const { writeAudit } = require("../../../../middlewares/auditWriter");

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

export type WorkspaceViewer = {
  userId: number;
  role: "OWNER" | "MANAGER" | "STAFF";
  orgIds: number[];
  branchIds: number[];
  canCreateTask: boolean;
  canAssignAny: boolean;
  canOverride: boolean;
  canSeeAllAlerts: boolean;
  canSeeAllApprovals: boolean;
};

export async function resolveWorkspaceViewer(userId: number): Promise<WorkspaceViewer | null> {
  const ownedOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  const ownerOrgIds = ownedOrgs.map((o: { id: number }) => o.id);
  if (ownerOrgIds.length > 0) {
    const branchIds = await prisma.branch.findMany({
      where: { orgId: { in: ownerOrgIds } },
      select: { id: true },
    }).then((b: { id: number }[]) => b.map((x) => x.id));
    return {
      userId,
      role: "OWNER",
      orgIds: ownerOrgIds,
      branchIds,
      canCreateTask: true,
      canAssignAny: true,
      canOverride: true,
      canSeeAllAlerts: true,
      canSeeAllApprovals: true,
    };
  }

  const branchMembers = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true, role: true },
  });
  const accessPerms = await prisma.branchAccessPermission.findMany({
    where: { userId, status: "APPROVED" },
    select: { branchId: true },
  });
  const staffBranchIds = [...new Set([
    ...branchMembers.map((b: { branchId: number }) => b.branchId),
    ...accessPerms.map((p: { branchId: number }) => p.branchId),
  ])];
  const isManager = branchMembers.some(
    (b: { role: string }) => b.role === "BRANCH_MANAGER" || b.role === "ORG_ADMIN"
  );
  if (isManager && staffBranchIds.length > 0) {
    const orgIds = await prisma.branch.findMany({
      where: { id: { in: staffBranchIds } },
      select: { orgId: true },
    }).then((b: { orgId: number }[]) => [...new Set(b.map((x) => x.orgId))]);
    return {
      userId,
      role: "MANAGER",
      orgIds,
      branchIds: staffBranchIds,
      canCreateTask: true,
      canAssignAny: true,
      canOverride: false,
      canSeeAllAlerts: true,
      canSeeAllApprovals: true,
    };
  }

  if (staffBranchIds.length > 0) {
    const orgIds = await prisma.branch.findMany({
      where: { id: { in: staffBranchIds } },
      select: { orgId: true },
    }).then((b: { orgId: number }[]) => [...new Set(b.map((x) => x.orgId))]);
    return {
      userId,
      role: "STAFF",
      orgIds,
      branchIds: staffBranchIds,
      canCreateTask: false,
      canAssignAny: false,
      canOverride: false,
      canSeeAllAlerts: false,
      canSeeAllApprovals: false,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const taskInclude = {
  org: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, profile: { select: { displayName: true, username: true } } } },
  createdBy: { select: { id: true, profile: { select: { displayName: true, username: true } } } },
  assignedBy: { select: { id: true, profile: { select: { displayName: true } } } },
  lastUpdatedBy: { select: { id: true, profile: { select: { displayName: true } } } },
  _count: { select: { comments: true } },
};

export async function listTasks(viewer: WorkspaceViewer, filters: {
  status?: string;
  branchId?: number;
  assignedToUserId?: number;
  type?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}) {
  const where: any = { deletedAt: null };
  if (viewer.role === "OWNER") {
    where.orgId = { in: viewer.orgIds };
  } else if (viewer.role === "MANAGER") {
    where.OR = [
      { branchId: { in: viewer.branchIds } },
      { branchId: null, orgId: { in: viewer.orgIds } },
    ];
  } else {
    where.assignedToUserId = viewer.userId;
  }
  if (filters.status) where.status = filters.status;
  if (filters.branchId != null) where.branchId = filters.branchId;
  if (filters.assignedToUserId != null) where.assignedToUserId = filters.assignedToUserId;
  if (filters.type) where.type = filters.type;
  if (filters.priority) where.priority = filters.priority;

  const [tasks, total] = await Promise.all([
    prisma.workspaceTask.findMany({
      where,
      include: taskInclude,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: Math.min(Number(filters.limit) || 50, 100),
      skip: Number(filters.offset) || 0,
    }),
    prisma.workspaceTask.count({ where }),
  ]);
  return { tasks, total };
}

export async function getTaskById(viewer: WorkspaceViewer, taskId: number) {
  const task = await prisma.workspaceTask.findFirst({
    where: { id: taskId, deletedAt: null },
    include: { ...taskInclude, comments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, profile: { select: { displayName: true } } } } } } },
  });
  if (!task) return null;
  if (viewer.role === "STAFF" && task.assignedToUserId !== viewer.userId) return null;
  if (viewer.role === "MANAGER" && task.branchId && !viewer.branchIds.includes(task.branchId)) return null;
  if (viewer.role === "MANAGER" && task.branchId === null && !viewer.orgIds.includes(task.orgId)) return null;
  if (viewer.role === "OWNER" && !viewer.orgIds.includes(task.orgId)) return null;
  return task;
}

export async function createTask(
  viewer: WorkspaceViewer,
  body: {
    title: string;
    description?: string;
    type: string;
    priority?: string;
    branchId?: number | null;
    assignedToUserId?: number | null;
    deadline?: string | null;
    linkedEntityJson?: Record<string, unknown> | null;
  },
  req: any
) {
  if (!viewer.canCreateTask) throw new Error("Not allowed to create tasks");
  const orgId = body.branchId
    ? (await prisma.branch.findUnique({ where: { id: body.branchId }, select: { orgId: true } }))?.orgId
    : viewer.orgIds[0];
  if (!orgId) throw new Error("Organization context required");
  if (body.branchId && viewer.role !== "OWNER" && !viewer.branchIds.includes(body.branchId)) throw new Error("Branch not in scope");
  if (body.assignedToUserId && !viewer.canAssignAny) throw new Error("Cannot assign");

  const task = await prisma.workspaceTask.create({
    data: {
      orgId,
      branchId: body.branchId ?? null,
      title: body.title,
      description: body.description ?? null,
      status: "TODO",
      type: body.type as any,
      priority: (body.priority as any) || "MEDIUM",
      assignedToUserId: body.assignedToUserId ?? null,
      createdByUserId: viewer.userId,
      assignedByUserId: body.assignedToUserId ? viewer.userId : null,
      lastUpdatedByUserId: viewer.userId,
      deadline: body.deadline ? new Date(body.deadline) : null,
      linkedEntityJson: body.linkedEntityJson ?? undefined,
    },
    include: taskInclude,
  });
  await writeAudit({
    prisma,
    req,
    action: "workspace.task.create",
    entityType: "WORKSPACE_TASK",
    entityId: String(task.id),
    after: { id: task.id, title: task.title, orgId: task.orgId, branchId: task.branchId },
  });
  return task;
}

export async function updateTask(
  viewer: WorkspaceViewer,
  taskId: number,
  body: Partial<{
    title: string;
    description: string;
    status: string;
    type: string;
    priority: string;
    assignedToUserId: number | null;
    deadline: string | null;
    resolutionNotes: string;
    linkedEntityJson: Record<string, unknown>;
  }>,
  req: any
) {
  const existing = await getTaskById(viewer, taskId);
  if (!existing) throw new Error("Task not found");
  if (viewer.role === "STAFF" && existing.assignedToUserId !== viewer.userId) throw new Error("Not your task");
  const canChangeAssignment = viewer.canAssignAny || viewer.canOverride;
  const updates: any = { lastUpdatedByUserId: viewer.userId };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.status !== undefined) updates.status = body.status;
  if (body.type !== undefined) updates.type = body.type;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.deadline !== undefined) updates.deadline = body.deadline ? new Date(body.deadline) : null;
  if (body.resolutionNotes !== undefined) updates.resolutionNotes = body.resolutionNotes;
  if (body.linkedEntityJson !== undefined) updates.linkedEntityJson = body.linkedEntityJson;
  if (body.assignedToUserId !== undefined) {
    if (!canChangeAssignment) throw new Error("Cannot change assignment");
    updates.assignedToUserId = body.assignedToUserId;
    updates.assignedByUserId = viewer.userId;
  }
  const task = await prisma.workspaceTask.update({
    where: { id: taskId },
    data: updates,
    include: taskInclude,
  });
  await writeAudit({
    prisma,
    req,
    action: "workspace.task.update",
    entityType: "WORKSPACE_TASK",
    entityId: String(taskId),
    before: { status: existing.status, assignedToUserId: existing.assignedToUserId },
    after: { status: task.status, assignedToUserId: task.assignedToUserId },
  });
  return task;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

function actorRoleFromViewer(viewer: WorkspaceViewer): string {
  return viewer.role;
}

export async function addTaskComment(
  viewer: WorkspaceViewer,
  taskId: number,
  body: { body: string; isPrivate?: boolean },
  req: any
) {
  const task = await getTaskById(viewer, taskId);
  if (!task) throw new Error("Task not found");
  if (body.isPrivate && viewer.role !== "OWNER") throw new Error("Only owner can add private notes");
  const comment = await prisma.workspaceTaskComment.create({
    data: {
      taskId,
      actorId: viewer.userId,
      actorRole: actorRoleFromViewer(viewer),
      body: body.body,
      isPrivate: !!body.isPrivate,
    },
    include: { actor: { select: { id: true, profile: { select: { displayName: true } } } } },
  });
  await writeAudit({
    prisma,
    req,
    action: "workspace.task.comment",
    entityType: "WORKSPACE_TASK",
    entityId: String(taskId),
    after: { commentId: comment.id },
  });
  return comment;
}

export async function listTaskComments(viewer: WorkspaceViewer, taskId: number) {
  const task = await getTaskById(viewer, taskId);
  if (!task) return [];
  const where: any = { taskId, deletedAt: null };
  if (viewer.role !== "OWNER") where.isPrivate = false;
  return prisma.workspaceTaskComment.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { id: true, profile: { select: { displayName: true } } } } },
  });
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export async function listAlerts(viewer: WorkspaceViewer, filters: { acknowledged?: boolean; branchId?: number; limit?: number; offset?: number }) {
  if (!viewer.canSeeAllAlerts && viewer.role === "STAFF") return { alerts: [], total: 0 };
  const where: any = {};
  if (viewer.role === "OWNER") where.orgId = { in: viewer.orgIds };
  else where.branchId = { in: viewer.branchIds };
  if (filters.acknowledged === false) where.acknowledgedAt = null;
  if (filters.acknowledged === true) where.acknowledgedAt = { not: null };
  if (filters.branchId != null) where.branchId = filters.branchId;
  const [alerts, total] = await Promise.all([
    prisma.workspaceAlert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(filters.limit) || 50, 100),
      skip: Number(filters.offset) || 0,
      include: {
        branch: { select: { id: true, name: true } },
        acknowledgedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    prisma.workspaceAlert.count({ where }),
  ]);
  return { alerts, total };
}

export async function acknowledgeAlert(viewer: WorkspaceViewer, alertId: number, req: any) {
  const alert = await prisma.workspaceAlert.findFirst({ where: { id: alertId } });
  if (!alert) throw new Error("Alert not found");
  if (viewer.role === "OWNER" && !viewer.orgIds.includes(alert.orgId)) throw new Error("Not in scope");
  if (viewer.role !== "OWNER" && (alert.branchId == null || !viewer.branchIds.includes(alert.branchId))) throw new Error("Not in scope");
  const updated = await prisma.workspaceAlert.update({
    where: { id: alertId },
    data: { acknowledgedAt: new Date(), acknowledgedByUserId: viewer.userId },
  });
  await writeAudit({ prisma, req, action: "workspace.alert.acknowledge", entityType: "WORKSPACE_ALERT", entityId: String(alertId), after: { acknowledgedAt: updated.acknowledgedAt } });
  return updated;
}

export async function convertAlertToTask(
  viewer: WorkspaceViewer,
  alertId: number,
  body: { title?: string; priority?: string; assignedToUserId?: number | null; branchId?: number | null },
  req: any
) {
  if (!viewer.canCreateTask) throw new Error("Not allowed to create tasks");
  const alert = await prisma.workspaceAlert.findFirst({ where: { id: alertId } });
  if (!alert) throw new Error("Alert not found");
  if (viewer.role === "OWNER" && !viewer.orgIds.includes(alert.orgId)) throw new Error("Not in scope");
  if (viewer.role !== "OWNER" && (alert.branchId == null || !viewer.branchIds.includes(alert.branchId))) throw new Error("Not in scope");
  if (alert.convertedToTaskId) throw new Error("Alert already converted");
  const task = await createTask(
    viewer,
    {
      title: body.title || alert.title,
      type: "SYSTEM",
      priority: (body.priority as any) || "MEDIUM",
      branchId: body.branchId ?? alert.branchId,
      assignedToUserId: body.assignedToUserId ?? undefined,
    },
    req
  );
  await prisma.workspaceAlert.update({
    where: { id: alertId },
    data: { convertedToTaskId: task.id },
  });
  await writeAudit({ prisma, req, action: "workspace.alert.convert_to_task", entityType: "WORKSPACE_ALERT", entityId: String(alertId), after: { taskId: task.id } });
  return task;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function listApprovals(viewer: WorkspaceViewer, filters: { status?: string; branchId?: number; limit?: number; offset?: number }) {
  if (!viewer.canSeeAllApprovals) return { approvals: [], total: 0 };
  const where: any = {};
  if (viewer.role === "OWNER") where.orgId = { in: viewer.orgIds };
  else where.branchId = { in: viewer.branchIds };
  if (filters.status) where.status = filters.status;
  if (filters.branchId != null) where.branchId = filters.branchId;
  const [approvals, total] = await Promise.all([
    prisma.workspaceApprovalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(filters.limit) || 50, 100),
      skip: Number(filters.offset) || 0,
      include: {
        branch: { select: { id: true, name: true } },
        requester: { select: { id: true, profile: { select: { displayName: true } } } },
        decidedBy: { select: { id: true, profile: { select: { displayName: true } } } },
      },
    }),
    prisma.workspaceApprovalRequest.count({ where }),
  ]);
  return { approvals, total };
}

export async function approveRequest(viewer: WorkspaceViewer, approvalId: number, req: any) {
  const approval = await prisma.workspaceApprovalRequest.findFirst({ where: { id: approvalId } });
  if (!approval) throw new Error("Approval not found");
  if (approval.status !== "PENDING") throw new Error("Already decided");
  if (viewer.role === "OWNER" && !viewer.orgIds.includes(approval.orgId)) throw new Error("Not in scope");
  if (viewer.role !== "OWNER" && (approval.branchId == null || !viewer.branchIds.includes(approval.branchId))) throw new Error("Not in scope");
  const updated = await prisma.workspaceApprovalRequest.update({
    where: { id: approvalId },
    data: { status: "APPROVED", decidedByUserId: viewer.userId, decidedAt: new Date() },
  });
  await writeAudit({ prisma, req, action: "workspace.approval.approve", entityType: "WORKSPACE_APPROVAL", entityId: String(approvalId), after: { status: "APPROVED" } });
  return updated;
}

export async function rejectRequest(viewer: WorkspaceViewer, approvalId: number, body: { reason: string }, req: any) {
  if (!body.reason || String(body.reason).trim().length === 0) throw new Error("Reject reason is required");
  const approval = await prisma.workspaceApprovalRequest.findFirst({ where: { id: approvalId } });
  if (!approval) throw new Error("Approval not found");
  if (approval.status !== "PENDING") throw new Error("Already decided");
  if (viewer.role === "OWNER" && !viewer.orgIds.includes(approval.orgId)) throw new Error("Not in scope");
  if (viewer.role !== "OWNER" && (approval.branchId == null || !viewer.branchIds.includes(approval.branchId))) throw new Error("Not in scope");
  const updated = await prisma.workspaceApprovalRequest.update({
    where: { id: approvalId },
    data: { status: "REJECTED", decidedByUserId: viewer.userId, decidedAt: new Date(), rejectReason: String(body.reason).trim() },
  });
  await writeAudit({ prisma, req, action: "workspace.approval.reject", entityType: "WORKSPACE_APPROVAL", entityId: String(approvalId), after: { status: "REJECTED", reason: body.reason } });
  return updated;
}

// ---------------------------------------------------------------------------
// Internal: create alert (call from inventory/orders/jobs for auto-alerts)
// ---------------------------------------------------------------------------

export async function createAlert(params: {
  orgId: number;
  branchId?: number | null;
  type: "LOW_STOCK" | "HIGH_CANCEL_RATE" | "STAFF_INACTIVITY" | "LOGIN_OUTSIDE_SHIFT" | "PERMISSION_VIOLATION" | "OVERDUE_TASK" | "OTHER";
  title: string;
  detailJson?: Record<string, unknown> | null;
}) {
  return prisma.workspaceAlert.create({
    data: {
      orgId: params.orgId,
      branchId: params.branchId ?? null,
      type: params.type,
      title: params.title,
      detailJson: params.detailJson ?? undefined,
    },
  });
}

export {};
