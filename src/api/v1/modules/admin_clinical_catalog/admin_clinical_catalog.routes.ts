const router = require("express").Router();
const authenticateToken = require("../../../../middleware/auth.middleware");
const adminOnly = require("../../../../middleware/admin.middleware");
const ctrl = require("./admin_clinical_catalog.controller");

// GET /api/v1/admin/clinical-catalog/items?orgId=&domainType=&page=&limit=
router.get("/items", authenticateToken, adminOnly, ctrl.listItems);
// GET /api/v1/admin/clinical-catalog/audit-logs?orgId=&itemId=&page=&limit=
router.get("/audit-logs", authenticateToken, adminOnly, ctrl.listAuditLogs);
// GET /api/v1/admin/clinical-catalog/approvals (pending)
router.get("/approvals", authenticateToken, adminOnly, ctrl.listPendingApprovals);
// POST /api/v1/admin/clinical-catalog/approvals/:logId/approve
router.post("/approvals/:logId/approve", authenticateToken, adminOnly, ctrl.approveRequest);
// POST /api/v1/admin/clinical-catalog/approvals/:logId/reject
router.post("/approvals/:logId/reject", authenticateToken, adminOnly, ctrl.rejectRequest);

// Master catalog (global categories, items, templates)
router.get("/master/categories", authenticateToken, adminOnly, ctrl.listMasterCategories);
router.get("/master/categories/tree", authenticateToken, adminOnly, ctrl.getMasterCategoryTree);
router.get("/master/items", authenticateToken, adminOnly, ctrl.listMasterItems);
router.get("/master/templates", authenticateToken, adminOnly, ctrl.listMasterTemplates);
router.get("/master/templates/:templateId", authenticateToken, adminOnly, ctrl.getMasterTemplateById);

module.exports = router;
