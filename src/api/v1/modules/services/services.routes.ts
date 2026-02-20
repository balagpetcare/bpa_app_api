const router = require("express").Router();
const controller = require("./services.controller");
const authenticateToken = require("../../../../middleware/auth.middleware");

// Helper function to check permissions
function requirePermission(...permissions) {
  return (req, res, next) => {
    const userPerms = req.user?.permissions || [];
    const hasPermission = permissions.some((perm) => userPerms.includes(perm));
    
    if (!hasPermission) {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
    }
    
    next();
  };
}

// All routes require authentication
router.use(authenticateToken);

// GET /api/v1/services - List services
router.get("/", controller.getServices);

// GET /api/v1/services/category/:category - Get services by category
router.get("/category/:category", controller.getServicesByCategory);

// GET /api/v1/services/:id - Get single service
router.get("/:id", controller.getService);

// POST /api/v1/services - Create service (requires permission)
router.post(
  "/",
  requirePermission("service.create", "org.write"),
  controller.createService
);

// PATCH /api/v1/services/:id - Update service (requires permission)
router.patch(
  "/:id",
  requirePermission("service.update", "org.write"),
  controller.updateService
);

// DELETE /api/v1/services/:id - Delete service (requires permission)
router.delete(
  "/:id",
  requirePermission("service.delete", "org.write"),
  controller.deleteService
);

module.exports = router;

export {};
