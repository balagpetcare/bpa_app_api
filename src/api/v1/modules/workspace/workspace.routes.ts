/**
 * Workspace routes – /api/v1/workspace/*
 * Auth required; scope enforced in controller via resolveWorkspaceViewer.
 */

const router = require("express").Router();
const auth = require("../../../../middlewares/auth");
const ctrl = require("./workspace.controller");

router.use(auth);

router.get("/me", ctrl.getWorkspaceMe);

router.get("/tasks", ctrl.listTasks);
router.post("/tasks", ctrl.createTask);
router.get("/tasks/:id", ctrl.getTask);
router.patch("/tasks/:id", ctrl.updateTask);
router.get("/tasks/:id/comments", ctrl.listTaskComments);
router.post("/tasks/:id/comments", ctrl.addTaskComment);

router.get("/alerts", ctrl.listAlerts);
router.patch("/alerts/:id/acknowledge", ctrl.acknowledgeAlert);
router.post("/alerts/:id/convert-to-task", ctrl.convertAlertToTask);

router.get("/approvals", ctrl.listApprovals);
router.post("/approvals/:id/approve", ctrl.approveRequest);
router.post("/approvals/:id/reject", ctrl.rejectRequest);

module.exports = router;

export {};
