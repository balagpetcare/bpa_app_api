/**
 * Owner panel – Universal Product Import endpoints.
 * Security: org/branch scope, rate limit on upload, max file size & max rows, sanitized storage.
 */
const prismaClient = require("../../../../infrastructure/db/prismaClient");
const { getEffectiveOrgIdsForOwnerPanel, getEffectiveBranchIdsForOwnerPanel } = require("../../services/ownerPanelAccess.service");
const { detectSourceType, parseFile } = require("../../services/product-import/ImportParser");
const { runBatchSyncSafe } = require("../../services/product-import/BatchRunner");
const { enqueueProductImportJob, isProductImportQueueEnabled } = require("../../services/productImportQueue");
const { MAX_IMPORT_ROWS, MAX_IMPORT_FILE_BYTES } = require("../../constants/productImportLimits");

function getUserId(req: any): number | null {
  const id = req.user?.id;
  return id != null ? Number(id) : null;
}

async function requireOrgId(req: any, res: any): Promise<number | null> {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return null;
  }
  const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaClient, userId);
  if (!orgIds.length) {
    res.status(403).json({ success: false, message: "No organization access" });
    return null;
  }
  const orgId = req.body?.orgId ?? req.query?.orgId ?? orgIds[0];
  if (!orgIds.includes(Number(orgId))) {
    res.status(403).json({ success: false, message: "Organization not accessible" });
    return null;
  }
  return Number(orgId);
}

async function requireBranchScope(req: any, res: any, orgId: number, branchId: number | null): Promise<boolean> {
  if (branchId == null) return true;
  const userId = getUserId(req);
  if (!userId) return false;
  const branchIds = await getEffectiveBranchIdsForOwnerPanel(prismaClient, userId);
  if (!branchIds.includes(branchId)) {
    res.status(403).json({ success: false, message: "Branch not accessible" });
    return false;
  }
  const branch = await prismaClient.branch.findFirst({ where: { id: branchId, orgId }, select: { id: true } });
  if (!branch) {
    res.status(404).json({ success: false, message: "Branch not found" });
    return false;
  }
  return true;
}

/** GET /imports/products – list batches for org */
exports.listImportBatches = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaClient, userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prismaClient.productImportBatch.findMany({
        where: { orgId: { in: orgIds } },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prismaClient.productImportBatch.count({ where: { orgId: { in: orgIds } } }),
    ]);

    return res.status(200).json({
      success: true,
      data: { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
    });
  } catch (e: any) {
    console.error("listImportBatches error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

/** POST /imports/products/upload – multipart file => create batch, enqueue (or sync), return batchId */
exports.uploadProductImport = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await requireOrgId(req, res);
    if (orgId == null) return;

    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, message: "No file uploaded. Use multipart field 'file'." });
    }
    if (file.buffer.length > MAX_IMPORT_FILE_BYTES) {
      return res.status(400).json({ success: false, message: `File too large. Max ${MAX_IMPORT_FILE_BYTES / 1024 / 1024}MB.` });
    }

    const sourceType = detectSourceType(file.mimetype, file.originalname);
    const provider = (req.body?.provider as string) || "csv";
    const filename = file.originalname || "upload.csv";
    const branchId = req.body?.branchId ? Number(req.body.branchId) : null;
    if (!(await requireBranchScope(req, res, orgId, branchId))) return;

    let rowCount = 0;
    try {
      const records = parseFile(file.buffer, sourceType);
      rowCount = records.length;
    } catch (parseErr) {
      return res.status(400).json({ success: false, message: "Invalid file format or encoding." });
    }
    if (rowCount > MAX_IMPORT_ROWS) {
      return res.status(400).json({ success: false, message: `Too many rows. Max ${MAX_IMPORT_ROWS}.` });
    }

    const batch = await prismaClient.productImportBatch.create({
      data: {
        orgId,
        branchId,
        sourceType: sourceType as any,
        provider,
        filename,
        status: "PENDING",
        totalRows: rowCount,
        createdBy: userId,
      },
    });

    const useQueue = isProductImportQueueEnabled();
    if (useQueue) {
      const enqueued = await enqueueProductImportJob({
        batchId: batch.id,
        orgId,
        branchId,
        createdByUserId: userId,
        provider,
        sourceType: sourceType as "CSV" | "EXCEL",
        filename,
        bufferBase64: file.buffer.toString("base64"),
      });
      if (!enqueued) {
        await runBatchSyncSafe(
          { prisma: prismaClient, orgId, branchId, createdByUserId: userId, provider, sourceType: sourceType as "CSV" | "EXCEL", filename },
          { batchId: batch.id, buffer: file.buffer }
        );
      }
    } else {
      runBatchSyncSafe(
        { prisma: prismaClient, orgId, branchId, createdByUserId: userId, provider, sourceType: sourceType as "CSV" | "EXCEL", filename },
        { batchId: batch.id, buffer: file.buffer }
      ).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      data: { batchId: batch.id, status: useQueue ? "PENDING" : "PROCESSING", filename, totalRows: rowCount },
    });
  } catch (e: any) {
    console.error("uploadProductImport error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Upload failed" });
  }
};

/** GET /imports/products/:batchId – batch summary + stats */
exports.getImportBatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaClient, userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const batchId = Number(req.params.batchId);
    if (!batchId) return res.status(400).json({ success: false, message: "Invalid batchId" });

    const batch = await prismaClient.productImportBatch.findFirst({
      where: { id: batchId, orgId: { in: orgIds } },
      include: { rows: { take: 0 } },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const totals = (batch.totals as any) || { total: 0, ready: 0, needsFix: 0, error: 0 };

    return res.status(200).json({
      success: true,
      data: {
        id: batch.id,
        orgId: batch.orgId,
        branchId: batch.branchId,
        sourceType: batch.sourceType,
        provider: batch.provider,
        filename: batch.filename,
        status: batch.status,
        totals,
        progress: {
          processedRows: batch.processedRows ?? 0,
          totalRows: batch.totalRows ?? 0,
          progressPercent: batch.progressPercent ?? null,
          startedAt: batch.startedAt,
          finishedAt: batch.finishedAt,
          errorMessage: batch.errorMessage,
        },
        createdBy: batch.createdBy,
        createdAt: batch.createdAt,
      },
    });
  } catch (e: any) {
    console.error("getImportBatch error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

/** GET /imports/products/:batchId/rows?status=NEEDS_FIX&page=1&limit=20 */
exports.getImportBatchRows = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaClient, userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const batchId = Number(req.params.batchId);
    if (!batchId) return res.status(400).json({ success: false, message: "Invalid batchId" });

    const batch = await prismaClient.productImportBatch.findFirst({
      where: { id: batchId, orgId: { in: orgIds } },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = { batchId };
    if (status && ["READY", "NEEDS_FIX", "ERROR"].includes(status)) where.status = status;

    const [rows, total] = await Promise.all([
      prismaClient.productImportRow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: "asc" },
      }),
      prismaClient.productImportRow.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      data: { items: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
    });
  } catch (e: any) {
    console.error("getImportBatchRows error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

/** POST /imports/products/:batchId/revalidate – rerun mapping/validation after mappings updated */
exports.revalidateImportBatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await requireOrgId(req, res);
    if (orgId == null) return;

    const batchId = Number(req.params.batchId);
    if (!batchId) return res.status(400).json({ success: false, message: "Invalid batchId" });

    const batch = await prismaClient.productImportBatch.findFirst({
      where: { id: batchId, orgId },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const rows = await prismaClient.productImportRow.findMany({
      where: { batchId },
      orderBy: { id: "asc" },
    });
    const normalizer = require("../../services/product-import/Normalizer").normalizeRow;
    const mapRow = require("../../services/product-import/Mapper").mapRow;
    const validateRow = require("../../services/product-import/Validator").validateRow;
    const upsertProduct = require("../../services/product-import/UpsertEngine").upsertProduct;

    const mapperOpts = { orgId, provider: batch.provider || "csv", prisma: prismaClient };
    const seenBarcodes = new Set<string>();
    const seenSkus = new Set<string>();
    let ready = 0,
      needsFix = 0,
      err = 0;

    for (const row of rows) {
      const raw = row.rawData as Record<string, string>;
      const externalKey = raw?.barcode || raw?.sku || raw?.variant_sku || row.externalProductKey;
      const normalized = normalizer(raw);
      const { resolved, issues: mapIssues } = await mapRow(mapperOpts, normalized);
      const validationIssues = validateRow(resolved, {
        existingBarcodes: seenBarcodes,
        existingSkus: seenSkus,
        orgId,
      });
      const allIssues = [...mapIssues, ...validationIssues];
      const upsertResult = await upsertProduct(
        {
          prisma: prismaClient,
          orgId,
          createdByUserId: userId,
          provider: batch.provider || "csv",
          batchId,
          externalProductKey: String(externalKey),
        },
        resolved,
        allIssues
      );
      const finalStatus = upsertResult.status === "READY" ? "READY" : upsertResult.status === "NEEDS_FIX" ? "NEEDS_FIX" : "ERROR";
      if (finalStatus === "READY") {
        ready++;
        if (resolved.barcode) seenBarcodes.add(resolved.barcode);
        if (resolved.sku) seenSkus.add(resolved.sku);
      } else if (finalStatus === "NEEDS_FIX") needsFix++;
      else err++;

      const issuesJson = (upsertResult.issues.length ? upsertResult.issues : allIssues) as object;
      await prismaClient.productImportRow.update({
        where: { id: row.id },
        data: {
          normalizedData: normalized as object,
          status: finalStatus,
          issues: issuesJson,
          matchedProductId: upsertResult.productId ?? undefined,
        },
      });
    }

    const totals = { total: rows.length, ready, needsFix, error: err };
    await prismaClient.productImportBatch.update({
      where: { id: batchId },
      data: { totals: totals as any },
    });

    return res.status(200).json({ success: true, data: { totals } });
  } catch (e: any) {
    console.error("revalidateImportBatch error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Revalidate failed" });
  }
};

/** POST /imports/mappings – create/update mapping (externalValue -> internalId); optional revalidateBatchId */
exports.upsertImportMapping = async (req: any, res: any) => {
  try {
    const orgId = await requireOrgId(req, res);
    if (orgId == null) return;

    const { provider, type, externalValue, internalId } = req.body || {};
    if (!provider || !type || externalValue === undefined || internalId == null) {
      return res.status(400).json({
        success: false,
        message: "Required: provider, type (CATEGORY|SUBCATEGORY|BRAND|UNIT), externalValue, internalId",
      });
    }
    const validTypes = ["CATEGORY", "SUBCATEGORY", "BRAND", "UNIT"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: "type must be one of " + validTypes.join(", ") });
    }

    const normalized = String(externalValue).trim().toLowerCase().replace(/\s+/g, " ");
    const mapping = await prismaClient.integrationMapping.upsert({
      where: {
        orgId_provider_type_externalValue: {
          orgId,
          provider: String(provider),
          type: type as any,
          externalValue: normalized,
        },
      },
      create: {
        orgId,
        provider: String(provider),
        type: type as any,
        externalValue: normalized,
        internalId: Number(internalId),
        lastUsedAt: new Date(),
      },
      update: { internalId: Number(internalId), lastUsedAt: new Date() },
    });

    return res.status(200).json({ success: true, data: mapping });
  } catch (e: any) {
    console.error("upsertImportMapping error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

/** GET /imports/mappings?type=BRAND&provider=csv */
exports.listImportMappings = async (req: any, res: any) => {
  try {
    const orgId = await requireOrgId(req, res);
    if (orgId == null) return;

    const type = req.query.type as string | undefined;
    const provider = req.query.provider as string | undefined;
    const where: any = { orgId };
    if (type) where.type = type;
    if (provider) where.provider = provider;

    const list = await prismaClient.integrationMapping.findMany({
      where,
      orderBy: [{ type: "asc" }, { externalValue: "asc" }],
    });

    return res.status(200).json({ success: true, data: list });
  } catch (e: any) {
    console.error("listImportMappings error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

/** POST /imports/products/:batchId/publish – publish READY rows => products become visible; returns published/skipped/errors */
exports.publishImportBatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaClient, userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const batchId = Number(req.params.batchId);
    if (!batchId) return res.status(400).json({ success: false, message: "Invalid batchId" });

    const batch = await prismaClient.productImportBatch.findFirst({
      where: { id: batchId, orgId: { in: orgIds } },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const rowIds = (req.body?.rowIds as number[] | undefined) || null;
    const allowWarnings = req.body?.allowWarnings === true;
    const where: any = { batchId, status: "READY" };
    if (rowIds && rowIds.length) where.id = { in: rowIds };

    const rows = await prismaClient.productImportRow.findMany({
      where,
      select: { id: true, matchedProductId: true, issues: true },
    });
    const toPublish = rows.filter((r: any) => r.matchedProductId != null);
    const productIds = toPublish.map((r: any) => r.matchedProductId);
    const publishWarningCount = toPublish.filter((r: any) => {
      const issues = (r.issues as Array<{ severity?: string }>) || [];
      return issues.some((i) => i.severity === "warning" || i.severity === "info");
    }).length;

    let published = 0;
    const errors: { rowId: number; message: string }[] = [];
    if (productIds.length) {
      const result = await prismaClient.product.updateMany({
        where: { id: { in: productIds }, orgId: { in: orgIds } },
        data: { publishStatus: "PUBLISHED", validationIssues: null },
      });
      published = result.count;
    }
    const skipped = rows.length - toPublish.length;

    let publishBlockedCount = 0;
    const blockedRows = await prismaClient.productImportRow.findMany({
      where: { batchId, status: "NEEDS_FIX" },
      select: { issues: true },
    });
    for (const r of blockedRows) {
      const issues = (r.issues as Array<{ severity?: string }>) || [];
      if (issues.some((i) => i.severity === "blocking")) publishBlockedCount++;
    }

    return res.status(200).json({
      success: true,
      data: {
        published,
        skipped,
        errors: errors.length ? errors : undefined,
        productIds: productIds.slice(0, 500),
        publishBlockedCount,
        publishWarningCount,
      },
    });
  } catch (e: any) {
    console.error("publishImportBatch error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Publish failed" });
  }
};

/** POST /imports/products/rows/:rowId/fix – apply one-click fix (set mapping or field), then revalidate row */
exports.fixImportRow = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await requireOrgId(req, res);
    if (orgId == null) return;

    const rowId = Number(req.params.rowId);
    if (!rowId) return res.status(400).json({ success: false, message: "Invalid rowId" });

    const row = await prismaClient.productImportRow.findFirst({
      where: { id: rowId },
      include: { batch: true },
    });
    if (!row || row.batch.orgId !== orgId) {
      return res.status(404).json({ success: false, message: "Row not found" });
    }

    const body = req.body || {};
    if (body.mapping) {
      const { type, externalValue, internalId } = body.mapping;
      if (type && externalValue !== undefined && internalId != null) {
        await prismaClient.integrationMapping.upsert({
          where: {
            orgId_provider_type_externalValue: {
              orgId,
              provider: row.batch.provider || "csv",
              type: type as any,
              externalValue: String(externalValue).trim().toLowerCase().replace(/\s+/g, " "),
            },
          },
          create: {
            orgId,
            provider: row.batch.provider || "csv",
            type: type as any,
            externalValue: String(externalValue).trim().toLowerCase().replace(/\s+/g, " "),
            internalId: Number(internalId),
          },
          update: { internalId: Number(internalId) },
        });
      }
    }

    const normalizer = require("../../services/product-import/Normalizer").normalizeRow;
    const mapRow = require("../../services/product-import/Mapper").mapRow;
    const validateRow = require("../../services/product-import/Validator").validateRow;
    const upsertProduct = require("../../services/product-import/UpsertEngine").upsertProduct;
    const mapperOpts = { orgId, provider: row.batch.provider || "csv", prisma: prismaClient };

    const raw = row.rawData as Record<string, string>;
    const normalized = normalizer(raw);
    if (body.setFields && typeof body.setFields === "object") {
      Object.assign(normalized, body.setFields);
    }
    const { resolved, issues: mapIssues } = await mapRow(mapperOpts, normalized);
    const validationIssues = validateRow(resolved, { orgId });
    const allIssues = [...mapIssues, ...validationIssues];
    const upsertResult = await upsertProduct(
      {
        prisma: prismaClient,
        orgId,
        createdByUserId: userId,
        provider: row.batch.provider || "csv",
        batchId: row.batchId,
        externalProductKey: row.externalProductKey,
      },
      resolved,
      allIssues
    );

    const finalStatus = upsertResult.status === "READY" ? "READY" : upsertResult.status === "NEEDS_FIX" ? "NEEDS_FIX" : "ERROR";
    const issuesJson = (upsertResult.issues.length ? upsertResult.issues : allIssues) as object;

    await prismaClient.productImportRow.update({
      where: { id: rowId },
      data: {
        normalizedData: normalized as object,
        status: finalStatus,
        issues: issuesJson,
        matchedProductId: upsertResult.productId ?? undefined,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        rowId,
        status: finalStatus,
        matchedProductId: upsertResult.productId ?? undefined,
        issues: upsertResult.issues.length ? upsertResult.issues : allIssues,
      },
    });
  } catch (e: any) {
    console.error("fixImportRow error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Fix failed" });
  }
};

/** POST /imports/products/unpublish – set product publishStatus back to DRAFT (only for import-created products in scope) */
exports.unpublishImportProduct = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaClient, userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const productId = Number(req.body?.productId);
    if (!productId) return res.status(400).json({ success: false, message: "productId required" });

    const product = await prismaClient.product.findFirst({
      where: { id: productId, orgId: { in: orgIds } },
      select: { id: true, importMeta: true },
    });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    await prismaClient.product.update({
      where: { id: productId },
      data: { publishStatus: "DRAFT" },
    });

    return res.status(200).json({ success: true, data: { productId, publishStatus: "DRAFT" } });
  } catch (e: any) {
    console.error("unpublishImportProduct error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Unpublish failed" });
  }
};

/** GET /imports/products/:batchId/insights – dashboard: issueCodeCounts, topUnmappedValues, counts, timeStats */
exports.getImportBatchInsights = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaClient, userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const batchId = Number(req.params.batchId);
    if (!batchId) return res.status(400).json({ success: false, message: "Invalid batchId" });

    const batch = await prismaClient.productImportBatch.findFirst({
      where: { id: batchId, orgId: { in: orgIds } },
      select: { orgId: true },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const { computeBatchInsights } = require("../../services/product-import/insightsService");
    const insights = await computeBatchInsights(prismaClient, batchId, batch.orgId);
    if (!insights) return res.status(404).json({ success: false, message: "Batch not found" });

    return res.status(200).json({
      success: true,
      data: {
        ...insights,
        timeStats: {
          createdAt: insights.timeStats.createdAt?.toISOString() ?? null,
          startedAt: insights.timeStats.startedAt?.toISOString() ?? null,
          finishedAt: insights.timeStats.finishedAt?.toISOString() ?? null,
          publishAt: insights.timeStats.publishAt?.toISOString() ?? null,
        },
      },
    });
  } catch (e: any) {
    console.error("getImportBatchInsights error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

/** GET /imports/products/:batchId/unmapped?type=BRAND|CATEGORY|SUBCATEGORY – external values with counts */
exports.getUnmappedValues = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgIds = await getEffectiveOrgIdsForOwnerPanel(prismaClient, userId);
    if (!orgIds.length) return res.status(403).json({ success: false, message: "No organization access" });

    const batchId = Number(req.params.batchId);
    const type = (req.query.type as string) || "BRAND";
    if (!["BRAND", "CATEGORY", "SUBCATEGORY"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be BRAND, CATEGORY, or SUBCATEGORY" });
    }

    const batch = await prismaClient.productImportBatch.findFirst({
      where: { id: batchId, orgId: { in: orgIds } },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const rows = await prismaClient.productImportRow.findMany({
      where: { batchId },
      select: { normalizedData: true, issues: true },
    });
    const field = type === "BRAND" ? "brand" : type === "CATEGORY" ? "category" : "subcategory";
    const code = type === "BRAND" ? "UNMAPPED_BRAND" : type === "CATEGORY" ? "UNMAPPED_CATEGORY" : "UNMAPPED_SUBCATEGORY";
    const byValue = new Map<string, number>();
    for (const row of rows) {
      const nd = row.normalizedData as Record<string, unknown> | null;
      const issues = (row.issues as Array<{ code: string }>) || [];
      const hasIssue = issues.some((i) => i.code === code);
      const val = nd?.[field];
      if (hasIssue && val != null && String(val).trim()) {
        const v = String(val).trim().toLowerCase();
        byValue.set(v, (byValue.get(v) || 0) + 1);
      }
    }
    const list = Array.from(byValue.entries()).map(([externalValue, count]) => ({ externalValue, count })).sort((a, b) => b.count - a.count);

    return res.status(200).json({ success: true, data: { type, items: list } });
  } catch (e: any) {
    console.error("getUnmappedValues error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Failed" });
  }
};

/** POST /imports/products/:batchId/bulk-fix – mapping updates + setFields, applyTo: rowIds or issueType */
exports.bulkFixImportBatch = async (req: any, res: any) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = await requireOrgId(req, res);
    if (orgId == null) return;

    const batchId = Number(req.params.batchId);
    const batch = await prismaClient.productImportBatch.findFirst({
      where: { id: batchId, orgId },
    });
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const body = req.body || {};
    const mappingUpdates = Array.isArray(body.mappingUpdates) ? body.mappingUpdates : [];
    const setFields = body.setFields && typeof body.setFields === "object" ? body.setFields : {};
    const applyToRowIds = Array.isArray(body.rowIds) ? body.rowIds : null;
    const applyToIssueType = body.issueType && String(body.issueType).trim() ? String(body.issueType) : null;
    const applyToByExternalValue =
      body.byExternalValue && typeof body.byExternalValue === "object" && body.byExternalValue.type && body.byExternalValue.externalValue != null
        ? { type: String(body.byExternalValue.type), externalValue: String(body.byExternalValue.externalValue).trim() }
        : null;

    for (const m of mappingUpdates) {
      if (m.type && m.externalValue != null && m.internalId != null) {
        const norm = String(m.externalValue).trim().toLowerCase().replace(/\s+/g, " ");
        await prismaClient.integrationMapping.upsert({
          where: {
            orgId_provider_type_externalValue: {
              orgId,
              provider: batch.provider || "csv",
              type: m.type,
              externalValue: norm,
            },
          },
          create: { orgId, provider: batch.provider || "csv", type: m.type, externalValue: norm, internalId: Number(m.internalId), lastUsedAt: new Date() },
          update: { internalId: Number(m.internalId), lastUsedAt: new Date() },
        });
      }
    }

    let rows = await prismaClient.productImportRow.findMany({
      where: { batchId },
      orderBy: { id: "asc" },
    });
    if (applyToRowIds && applyToRowIds.length) {
      rows = rows.filter((r) => applyToRowIds.includes(r.id));
    } else if (applyToIssueType) {
      rows = rows.filter((r) => {
        const issues = (r.issues as Array<{ code: string }>) || [];
        return issues.some((i) => i.code === applyToIssueType);
      });
    } else if (applyToByExternalValue) {
      const code =
        applyToByExternalValue.type === "BRAND"
          ? "UNMAPPED_BRAND"
          : applyToByExternalValue.type === "CATEGORY"
            ? "UNMAPPED_CATEGORY"
            : applyToByExternalValue.type === "SUBCATEGORY"
              ? "UNMAPPED_SUBCATEGORY"
              : null;
      const field = applyToByExternalValue.type === "BRAND" ? "brand" : applyToByExternalValue.type === "CATEGORY" ? "category" : "subcategory";
      const normVal = applyToByExternalValue.externalValue.toLowerCase().replace(/\s+/g, " ");
      rows = rows.filter((r) => {
        const issues = (r.issues as Array<{ code: string }>) || [];
        if (!code || !issues.some((i) => i.code === code)) return false;
        const nd = r.normalizedData as Record<string, unknown> | null;
        const val = nd?.[field];
        return val != null && String(val).trim().toLowerCase().replace(/\s+/g, " ") === normVal;
      });
    }

    const normalizer = require("../../services/product-import/Normalizer").normalizeRow;
    const mapRow = require("../../services/product-import/Mapper").mapRow;
    const validateRow = require("../../services/product-import/Validator").validateRow;
    const upsertProduct = require("../../services/product-import/UpsertEngine").upsertProduct;
    const mapperOpts = { orgId, provider: batch.provider || "csv", prisma: prismaClient };
    const seenBarcodes = new Set<string>();
    const seenSkus = new Set<string>();
    let fixed = 0;
    for (const row of rows) {
      const raw = row.rawData as Record<string, string>;
      const normalized = normalizer(raw);
      if (Object.keys(setFields).length) Object.assign(normalized, setFields);
      const { resolved, issues: mapIssues } = await mapRow(mapperOpts, normalized);
      const validationIssues = validateRow(resolved, { existingBarcodes: seenBarcodes, existingSkus: seenSkus, orgId });
      const allIssues = [...mapIssues, ...validationIssues];
      const upsertResult = await upsertProduct(
        { prisma: prismaClient, orgId, createdByUserId: userId, provider: batch.provider || "csv", batchId, externalProductKey: row.externalProductKey },
        resolved,
        allIssues
      );
      const finalStatus = upsertResult.status === "READY" ? "READY" : upsertResult.status === "NEEDS_FIX" ? "NEEDS_FIX" : "ERROR";
      if (finalStatus === "READY") {
        fixed++;
        if (resolved.barcode) seenBarcodes.add(resolved.barcode);
        if (resolved.sku) seenSkus.add(resolved.sku);
      }
      const issuesJson = (upsertResult.issues.length ? upsertResult.issues : allIssues) as object;
      await prismaClient.productImportRow.update({
        where: { id: row.id },
        data: { normalizedData: normalized as object, status: finalStatus, issues: issuesJson, matchedProductId: upsertResult.productId ?? undefined },
      });
    }

    const allRows = await prismaClient.productImportRow.findMany({
      where: { batchId },
      select: { status: true },
    });
    const total = allRows.length;
    const ready = allRows.filter((r) => r.status === "READY").length;
    const needsFix = allRows.filter((r) => r.status === "NEEDS_FIX").length;
    const error = allRows.filter((r) => r.status === "ERROR").length;
    await prismaClient.productImportBatch.update({
      where: { id: batchId },
      data: { totals: { total, ready, needsFix, error } },
    });

    return res.status(200).json({ success: true, data: { applied: rows.length, fixed, totals: { total, ready, needsFix, error } } });
  } catch (e: any) {
    console.error("bulkFixImportBatch error:", e);
    return res.status(500).json({ success: false, message: e?.message || "Bulk fix failed" });
  }
};

export {};
