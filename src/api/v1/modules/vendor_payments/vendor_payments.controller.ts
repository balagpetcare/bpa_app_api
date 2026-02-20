/**
 * POST /api/v1/vendor-payments
 * Record a vendor payment (credit in vendor ledger). OWNER/ADMIN only, org-scoped.
 */
const grnService = require("../grn/grn.service");
const prisma = require("../../../../infrastructure/db/prismaClient").default;

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getOrgIds(req: any): Promise<number[]> {
  const userId = getUserId(req);
  if (!userId) return [];
  return grnService.getOrgIdsForUser(userId);
}

export async function createVendorPayment(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIds(req);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const { vendorId, orgId, amount, method, reference, note } = req.body;
    const numVendorId = vendorId != null ? parseInt(String(vendorId), 10) : NaN;
    const numOrgId = orgId != null ? parseInt(String(orgId), 10) : NaN;
    const numAmount = amount != null ? parseFloat(amount) : NaN;

    if (!Number.isFinite(numVendorId) || !Number.isFinite(numOrgId) || !Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "vendorId, orgId, and amount (positive number) are required",
      });
    }
    if (!orgIds.includes(numOrgId)) {
      return res.status(403).json({ success: false, message: "Organization not accessible" });
    }

    const vendor = await prisma.vendor.findFirst({
      where: { id: numVendorId, orgId: numOrgId },
    });
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found or does not belong to organization" });
    }

    const entry = await prisma.vendorLedgerEntry.create({
      data: {
        vendorId: numVendorId,
        orgId: numOrgId,
        sourceType: "PAYMENT",
        sourceId: reference?.trim() || (note?.trim() ? `Note: ${note.trim()}` : null),
        debit: 0,
        credit: numAmount,
      },
    });

    return res.status(201).json({
      success: true,
      data: entry,
      message: "Vendor payment recorded",
    });
  } catch (e) {
    console.error("createVendorPayment error:", e);
    return res.status(500).json({
      success: false,
      message: (e as Error).message || "Failed to record payment",
    });
  }
}
