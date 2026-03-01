const prisma = require("../../../../infrastructure/db/prismaClient");
const { getTraceId, successEnvelope, errorEnvelope } = require("../../utils/governanceResponses");
const { getGroupedRegistry } = require("../../services/permissionsRegistry.service");

/**
 * GET /admin/permissions
 * Default: human-readable permissions registry (grouped), Appendix A envelope with traceId.
 * Query ?source=db: legacy DB Permission list for role assignment UI (also in envelope).
 */
exports.list = async (req, res) => {
  const traceId = getTraceId(req);
  try {
    if (req.query?.source === "db") {
      const rows = await prisma.permission.findMany({
        orderBy: { key: "asc" },
      });
      return res.json(successEnvelope({ items: rows }, "Permissions list (DB)", "OK", traceId));
    }
    const groups = getGroupedRegistry();
    return res.json(
      successEnvelope(
        { groups },
        "Human-readable permissions registry",
        "OK",
        traceId
      )
    );
  } catch (e) {
    console.error("admin_permissions.list error", e);
    return res
      .status(500)
      .json(errorEnvelope("SERVER_ERROR", e?.message ?? "Server Error", undefined, traceId));
  }
};

export {};
