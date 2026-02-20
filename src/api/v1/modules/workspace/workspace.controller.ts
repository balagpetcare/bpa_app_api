/**
 * Workspace Controller – /api/v1/workspace/*
 * Role-aware: Owner (full), Manager (branch), Staff (my tasks only).
 */

const workspaceService = require("./workspace.service");

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getViewer(req: any, res: any): Promise<any> {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  const viewer = await workspaceService.resolveWorkspaceViewer(userId);
  if (!viewer) {
    res.status(403).json({ success: false, message: "No workspace access" });
    return null;
  }
  return viewer;
}

// GET /workspace/tasks
async function listTasks(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const filters = {
      status: req.query.status as string | undefined,
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      assignedToUserId: req.query.assignedToUserId ? Number(req.query.assignedToUserId) : undefined,
      type: req.query.type as string | undefined,
      priority: req.query.priority as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };
    const result = await workspaceService.listTasks(viewer, filters);
    res.json({ success: true, data: result.tasks, total: result.total });
  } catch (e: any) {
    console.error("workspace.listTasks", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to list tasks" });
  }
}

// POST /workspace/tasks
async function createTask(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const task = await workspaceService.createTask(viewer, req.body || {}, req);
    res.status(201).json({ success: true, data: task });
  } catch (e: any) {
    console.error("workspace.createTask", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to create task" });
  }
}

// GET /workspace/tasks/:id
async function getTask(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const id = Number(req.params.id);
    const task = await workspaceService.getTaskById(viewer, id);
    if (!task) {
      res.status(404).json({ success: false, message: "Task not found" });
      return;
    }
    res.json({ success: true, data: task });
  } catch (e: any) {
    console.error("workspace.getTask", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to get task" });
  }
}

// PATCH /workspace/tasks/:id
async function updateTask(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const id = Number(req.params.id);
    const task = await workspaceService.updateTask(viewer, id, req.body || {}, req);
    res.json({ success: true, data: task });
  } catch (e: any) {
    console.error("workspace.updateTask", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to update task" });
  }
}

// POST /workspace/tasks/:id/comments
async function addTaskComment(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const taskId = Number(req.params.id);
    const comment = await workspaceService.addTaskComment(viewer, taskId, req.body || {}, req);
    res.status(201).json({ success: true, data: comment });
  } catch (e: any) {
    console.error("workspace.addTaskComment", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to add comment" });
  }
}

// GET /workspace/tasks/:id/comments
async function listTaskComments(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const taskId = Number(req.params.id);
    const comments = await workspaceService.listTaskComments(viewer, taskId);
    res.json({ success: true, data: comments });
  } catch (e: any) {
    console.error("workspace.listTaskComments", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to list comments" });
  }
}

// GET /workspace/alerts
async function listAlerts(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const filters = {
      acknowledged: req.query.acknowledged === "true" ? true : req.query.acknowledged === "false" ? false : undefined,
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };
    const result = await workspaceService.listAlerts(viewer, filters);
    res.json({ success: true, data: result.alerts, total: result.total });
  } catch (e: any) {
    console.error("workspace.listAlerts", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to list alerts" });
  }
}

// PATCH /workspace/alerts/:id/acknowledge
async function acknowledgeAlert(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const id = Number(req.params.id);
    const alert = await workspaceService.acknowledgeAlert(viewer, id, req);
    res.json({ success: true, data: alert });
  } catch (e: any) {
    console.error("workspace.acknowledgeAlert", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to acknowledge alert" });
  }
}

// POST /workspace/alerts/:id/convert-to-task
async function convertAlertToTask(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const id = Number(req.params.id);
    const task = await workspaceService.convertAlertToTask(viewer, id, req.body || {}, req);
    res.status(201).json({ success: true, data: task });
  } catch (e: any) {
    console.error("workspace.convertAlertToTask", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to convert alert to task" });
  }
}

// GET /workspace/approvals
async function listApprovals(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const filters = {
      status: req.query.status as string | undefined,
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    };
    const result = await workspaceService.listApprovals(viewer, filters);
    res.json({ success: true, data: result.approvals, total: result.total });
  } catch (e: any) {
    console.error("workspace.listApprovals", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to list approvals" });
  }
}

// POST /workspace/approvals/:id/approve
async function approveRequest(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const id = Number(req.params.id);
    const approval = await workspaceService.approveRequest(viewer, id, req);
    res.json({ success: true, data: approval });
  } catch (e: any) {
    console.error("workspace.approveRequest", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to approve" });
  }
}

// POST /workspace/approvals/:id/reject
async function rejectRequest(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    const id = Number(req.params.id);
    const approval = await workspaceService.rejectRequest(viewer, id, req.body || {}, req);
    res.json({ success: true, data: approval });
  } catch (e: any) {
    console.error("workspace.rejectRequest", e);
    res.status(400).json({ success: false, message: e?.message || "Failed to reject" });
  }
}

// GET /workspace/me – viewer role and scope for UI
async function getWorkspaceMe(req: any, res: any) {
  try {
    const viewer = await getViewer(req, res);
    if (!viewer) return;
    res.json({
      success: true,
      data: {
        role: viewer.role,
        orgIds: viewer.orgIds,
        branchIds: viewer.branchIds,
        canCreateTask: viewer.canCreateTask,
        canAssignAny: viewer.canAssignAny,
        canOverride: viewer.canOverride,
        canSeeAllAlerts: viewer.canSeeAllAlerts,
        canSeeAllApprovals: viewer.canSeeAllApprovals,
      },
    });
  } catch (e: any) {
    console.error("workspace.getWorkspaceMe", e);
    res.status(400).json({ success: false, message: e?.message || "Failed" });
  }
}

module.exports = {
  listTasks,
  createTask,
  getTask,
  updateTask,
  addTaskComment,
  listTaskComments,
  listAlerts,
  acknowledgeAlert,
  convertAlertToTask,
  listApprovals,
  approveRequest,
  rejectRequest,
  getWorkspaceMe,
};

export {};
