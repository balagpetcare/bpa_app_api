/**
 * Catalog Enable Request controller.
 * POST/GET /api/v1/catalog-requests, GET /:id, POST /:id/approve, POST /:id/decline
 */
const service = require("./catalog_requests.service");
const prisma = require("../../../../infrastructure/db/prismaClient").default;

function getUserId(req: any): number | null {
  const id = req?.user?.id ?? req?.user?.userId;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getOrgIdsForUser(userId: number): Promise<number[]> {
  const ownerOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (ownerOrgs.length) return ownerOrgs.map((o) => o.id);
  const member = await prisma.orgMember.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  return member ? [member.orgId] : [];
}

async function getBranchIdsForUser(userId: number): Promise<number[]> {
  const members = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true },
  });
  return members.map((m) => m.branchId);
}

export async function create(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIdsForUser(userId);
    const branchIds = await getBranchIdsForUser(userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const { branchId, productId, variantId, locationId, requestedPrice } = req.body;
    if (!branchId || !productId || !variantId) {
      return res.status(400).json({ success: false, message: "branchId, productId, variantId are required" });
    }
    const branch = await prisma.branch.findUnique({
      where: { id: Number(branchId) },
      select: { orgId: true },
    });
    if (!branch || !orgIds.includes(branch.orgId)) {
      return res.status(400).json({ success: false, message: "Branch not found or not accessible" });
    }
    if (!branchIds.includes(Number(branchId)) && !orgIds.includes(branch.orgId)) {
      return res.status(403).json({ success: false, message: "Not authorized to create request for this branch" });
    }
    const request = await service.createCatalogRequest({
      orgId: branch.orgId,
      branchId: Number(branchId),
      productId: Number(productId),
      variantId: Number(variantId),
      locationId: locationId ? Number(locationId) : undefined,
      requestedPrice: requestedPrice != null ? Number(requestedPrice) : undefined,
      requestedByUserId: userId,
    });
    return res.status(201).json({ success: true, data: request });
  } catch (e: any) {
    console.error("catalog_requests.create", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to create request" });
  }
}

export async function list(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIdsForUser(userId);
    if (!orgIds.length) {
      return res.status(200).json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    }
    const orgId = req.query.orgId ? Number(req.query.orgId) : orgIds[0];
    if (!orgIds.includes(orgId)) return res.status(403).json({ success: false, message: "Organization not accessible" });

    const result = await service.listCatalogRequests({
      orgId,
      branchId: req.query.branchId ? Number(req.query.branchId) : undefined,
      status: req.query.status as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    });
    return res.status(200).json({ success: true, data: result.items, pagination: result.pagination });
  } catch (e: any) {
    console.error("catalog_requests.list", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to list" });
  }
}

export async function getById(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIdsForUser(userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const request = await service.getCatalogRequestById(id, orgIds[0]);
    if (!request) return res.status(404).json({ success: false, message: "Request not found" });
    return res.status(200).json({ success: true, data: request });
  } catch (e: any) {
    console.error("catalog_requests.getById", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed to get request" });
  }
}

export async function approve(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIdsForUser(userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const ownerOrg = await prisma.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (!ownerOrg || ownerOrg.id !== orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can approve" });
    }
    const { price } = req.body || {};
    const request = await service.approveCatalogRequest(id, orgId, userId, price != null ? Number(price) : undefined);
    return res.status(200).json({ success: true, data: request, message: "Approved" });
  } catch (e: any) {
    console.error("catalog_requests.approve", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to approve" });
  }
}

export async function decline(req: any, res: any) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getOrgIdsForUser(userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    const orgId = orgIds[0];
    const ownerOrg = await prisma.organization.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (!ownerOrg || ownerOrg.id !== orgId) {
      return res.status(403).json({ success: false, message: "Only org owner can decline" });
    }
    const { reviewNote } = req.body || {};
    const request = await service.declineCatalogRequest(id, orgId, userId, reviewNote);
    return res.status(200).json({ success: true, data: request, message: "Declined" });
  } catch (e: any) {
    console.error("catalog_requests.decline", e);
    return res.status(400).json({ success: false, message: e?.message || "Failed to decline" });
  }
}
