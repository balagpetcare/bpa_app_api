const prisma = require("../../../../infrastructure/db/prismaClient");
const bcrypt = require("bcrypt");
const featureFlag = require("../../services/governance/featureFlag.service");
const quota = require("../../services/governance/quota.service");
const approvalPolicy = require("../../services/governance/approvalPolicy.service");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");
const { resolvePermissionsForUser } = require("../../utils/permissions");
const { hmacHash, encryptCode, decryptCode } = require("../../utils/authCodeHasher");
const { UTF8_BOM, escapeCell, formatDate, formatIso, buildCsv, rowToCsvLine, slugify, filenameTimestamp } = require("../../utils/csvExportHelper");
const { writeProducerAudit } = require("./producerAudit");
const crypto = require("crypto");

type AppError = Error & { statusCode?: number; code?: string };

type PaginationParams = {
  page?: string | number;
  limit?: string | number;
};

function createError(message: string, statusCode: number, code?: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

const VALID_BATCH_STATUSES = ["DRAFT", "APPROVED", "REJECTED", "GENERATED"];

export type SummaryExportFilters = {
  status?: string[];
  factoryId?: number;
  productId?: number;
  search?: string;
  createdFrom?: Date;
  createdTo?: Date;
  mfgFrom?: Date;
  mfgTo?: Date;
};

/**
 * Parse and validate summary export filters from query. Throws createError(..., 400) with code on invalid.
 */
function parseSummaryExportFilters(raw: Record<string, unknown>): SummaryExportFilters {
  const out: SummaryExportFilters = {};
  if (raw.status != null && String(raw.status).trim() !== "") {
    const list = String(raw.status)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const invalid = list.filter((s) => !VALID_BATCH_STATUSES.includes(s));
    if (invalid.length) {
      const e = createError(`Invalid status value(s): ${invalid.join(", ")}. Allowed: ${VALID_BATCH_STATUSES.join(", ")}`, 400);
      (e as any).code = "INVALID_FILTER";
      throw e;
    }
    out.status = list;
  }
  if (raw.factoryId != null && String(raw.factoryId).trim() !== "") {
    const n = Number(raw.factoryId);
    if (!Number.isInteger(n) || n < 1) {
      const e = createError("factoryId must be a positive integer", 400);
      (e as any).code = "INVALID_FILTER";
      throw e;
    }
    out.factoryId = n;
  }
  if (raw.productId != null && String(raw.productId).trim() !== "") {
    const n = Number(raw.productId);
    if (!Number.isInteger(n) || n < 1) {
      const e = createError("productId must be a positive integer", 400);
      (e as any).code = "INVALID_FILTER";
      throw e;
    }
    out.productId = n;
  }
  if (raw.search != null && String(raw.search).trim() !== "") {
    out.search = String(raw.search).trim().slice(0, 200);
  }
  if (raw.createdFrom != null && String(raw.createdFrom).trim() !== "") {
    const d = new Date(raw.createdFrom as string);
    if (Number.isNaN(d.getTime())) {
      const e = createError("createdFrom must be a valid ISO date/time", 400);
      (e as any).code = "INVALID_FILTER";
      throw e;
    }
    out.createdFrom = d;
  }
  if (raw.createdTo != null && String(raw.createdTo).trim() !== "") {
    const d = new Date(raw.createdTo as string);
    if (Number.isNaN(d.getTime())) {
      const e = createError("createdTo must be a valid ISO date/time", 400);
      (e as any).code = "INVALID_FILTER";
      throw e;
    }
    if (String(raw.createdTo).trim().length <= 10) d.setHours(23, 59, 59, 999);
    out.createdTo = d;
  }
  if (raw.mfgFrom != null && String(raw.mfgFrom).trim() !== "") {
    const s = String(raw.mfgFrom).trim();
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      const e = createError("mfgFrom must be YYYY-MM-DD or valid date", 400);
      (e as any).code = "INVALID_FILTER";
      throw e;
    }
    out.mfgFrom = d;
  }
  if (raw.mfgTo != null && String(raw.mfgTo).trim() !== "") {
    const s = String(raw.mfgTo).trim();
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      const e = createError("mfgTo must be YYYY-MM-DD or valid date", 400);
      (e as any).code = "INVALID_FILTER";
      throw e;
    }
    if (s.length <= 10) d.setHours(23, 59, 59, 999);
    out.mfgTo = d;
  }
  return out;
}

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomChars(length: number) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function normalizeCodePart(value: any, expectedLen: number, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const part = String(value).trim().toUpperCase();
  if (part.length !== expectedLen) {
    throw createError(`${label} must be ${expectedLen} characters`, 400);
  }
  if (!/^[A-Z0-9]+$/.test(part)) {
    throw createError(`${label} must contain only A-Z and 0-9`, 400);
  }
  return part;
}

function resolveCodeFormat({ length, prefix, suffix }: { length?: any; prefix?: any; suffix?: any }) {
  const requestedLength = length ? Number(length) : 12;
  if (!requestedLength || requestedLength < 8 || requestedLength > 15) {
    throw createError("length must be between 8 and 15", 400);
  }
  const customPrefix = normalizeCodePart(prefix, 3, "prefix");
  const customSuffix = normalizeCodePart(suffix, 2, "suffix");
  const prefixLen = customPrefix ? customPrefix.length : 0;
  const suffixLen = customSuffix ? customSuffix.length : 0;
  if (requestedLength <= prefixLen + suffixLen) {
    throw createError("length is too short for prefix/suffix", 400);
  }
  return {
    length: requestedLength,
    prefix: customPrefix,
    suffix: customSuffix,
    middleLength: requestedLength - prefixLen - suffixLen,
  };
}

function buildPublicCode(opts: { length?: any; prefix?: any; suffix?: any }) {
  const format = resolveCodeFormat(opts);
  const middle = randomChars(format.middleLength);
  return {
    code: `${format.prefix || ""}${middle}${format.suffix || ""}`,
    format,
  };
}

async function getProducerOrgByUser(userId) {
  return prisma.producerOrg.findFirst({ where: { ownerUserId: userId } });
}

async function ensureProducerOwnerRole(producerOrgId, ownerUserId) {
  const role = await prisma.role.findUnique({
    where: { key: "PRODUCER_OWNER" },
    select: { id: true },
  });
  if (!role) return;

  await prisma.producerOrgStaff.upsert({
    where: {
      producerOrgId_userId: {
        producerOrgId,
        userId: ownerUserId,
      },
    },
    update: { roleId: role.id },
    create: {
      producerOrgId,
      userId: ownerUserId,
      roleId: role.id,
      invitedBy: null,
    },
  });
}

async function registerProducer({ name, email, phone, password }) {
  const emailNorm = (email || "").trim().toLowerCase();
  const phoneNormRaw = (phone || "").trim();
  const phoneNorm = phoneNormRaw ? phoneNormRaw.replace(/\D/g, "") : "";

  if (!emailNorm && !phoneNorm) {
    throw createError("email or phone is required", 400);
  }
  if (!password || password.length < 4) {
    throw createError("password is required (min 4 chars)", 400);
  }

  const existingAuth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
        phoneNorm ? { phone: phoneNorm } : undefined,
      ].filter(Boolean),
    },
    select: { id: true },
  });
  if (existingAuth) {
    throw createError("User already exists", 400);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const displayName = (name && name.trim()) ? name.trim() : "Producer User";
  const username = `${displayName.toLowerCase().replace(/\s+/g, "")}_${Date.now()}`.slice(0, 30);

  const user = await prisma.user.create({
    data: {
      auth: { create: { email: emailNorm || null, phone: phoneNorm || null, passwordHash } },
      profile: { create: { displayName, username } },
      wallet: { create: { balance: 0.0, points: 0, tier: "Bronze", currency: "BDT" } },
    },
    include: { auth: true, profile: true },
  });

  await prisma.producerOrg.create({
    data: {
      ownerUserId: user.id,
      name: displayName,
      status: "PENDING",
    },
  });
  const producerOrg = await getProducerOrgByUser(user.id);
  if (producerOrg) {
    await ensureProducerOwnerRole(producerOrg.id, user.id);
  }

  const perms = await resolvePermissionsForUser(user.id);
  const token = jwt.sign({ id: user.id, perms, tv: user.tokenVersion || 0 }, appConfig.jwt.secret, { expiresIn: "7d" });

  return { user, token };
}

async function loginProducer({ email, phone, password }) {
  const emailNorm = (email || "").trim().toLowerCase();
  const phoneNormRaw = (phone || "").trim();
  const phoneNorm = phoneNormRaw ? phoneNormRaw.replace(/\D/g, "") : "";
  if (!emailNorm && !phoneNorm) {
    throw createError("email or phone is required", 400);
  }
  if (!password) {
    throw createError("password is required", 400);
  }

  const auth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
        phoneNorm ? { phone: phoneNorm } : undefined,
      ].filter(Boolean),
    },
    include: { user: { include: { profile: true } } },
  });
  if (!auth) {
    throw createError("Invalid credentials", 401);
  }
  const ok = await bcrypt.compare(password, auth.passwordHash || "");
  if (!ok) {
    throw createError("Invalid credentials", 401);
  }

  const perms = await resolvePermissionsForUser(auth.userId);
  const token = jwt.sign(
    { id: auth.userId, perms, tv: auth.user?.tokenVersion || 0 },
    appConfig.jwt.secret,
    { expiresIn: "7d" }
  );
  return { user: auth.user, token };
}

/**
 * Legacy KYC submit: updates ProducerOrg name/countryCode and persists docsJson to legacyDocsJson
 * (do not rely on file refs in docsJson; use /kyc/documents for uploads).
 */
async function submitKyc({ userId, name, countryCode, docsJson }) {
  const org = await getProducerOrgByUser(userId);
  if (!org) {
    const created = await prisma.producerOrg.create({
      data: {
        ownerUserId: userId,
        name: name || "Producer Org",
        countryCode: countryCode || null,
        docsJson: docsJson || null,
        legacyDocsJson: docsJson || null,
        status: "PENDING",
      },
    });
    await ensureProducerOwnerRole(created.id, userId);
    return created;
  }

  const updated = await prisma.producerOrg.update({
    where: { id: org.id },
    data: {
      ...(name ? { name } : {}),
      ...(countryCode ? { countryCode } : {}),
      ...(docsJson ? { docsJson, legacyDocsJson: docsJson } : {}),
      status: "PENDING",
    },
  });
  await ensureProducerOwnerRole(org.id, userId);
  return updated;
}

async function getKycStatus(userId) {
  return getProducerOrgByUser(userId);
}

async function getMe(userId, producerOrgId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, auth: true },
  });
  const org = producerOrgId
    ? await prisma.producerOrg.findUnique({ where: { id: Number(producerOrgId) } })
    : await getProducerOrgByUser(userId);
  const permissions = await resolvePermissionsForUser(userId);
  const isProducerOwner = !!(org && org.ownerUserId === userId);
  return { user, org, permissions: Array.isArray(permissions) ? permissions : [], isProducerOwner };
}

async function listProducts(producerOrgId) {
  if (!producerOrgId) return [];
  return prisma.authProduct.findMany({
    where: { producerOrgId: Number(producerOrgId) },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Paginated, searchable product list for pickers (e.g. batch creation).
 * Only returns eligible products when onlyApproved: APPROVED or ACTIVE.
 * @param {number} producerOrgId
 * @param {{ q?: string, page?: number, limit?: number, onlyApproved?: boolean, onlyActive?: boolean }} opts
 * @returns {{ items: Array<{ id, name, sku, isActive, approvalStatus }>, page, limit, total }}
 */
async function listProductsPick(producerOrgId, opts: Record<string, any> = {}) {
  if (!producerOrgId) return { items: [], page: 1, limit: 20, total: 0 };
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 20));
  const onlyApproved = opts.onlyApproved !== false;
  const onlyActive = opts.onlyActive === true;
  const q = typeof opts.q === "string" ? opts.q.trim() : "";

  const where: any = { producerOrgId: Number(producerOrgId) };
  if (onlyApproved) {
    where.status = onlyActive ? "ACTIVE" : { in: ["APPROVED", "ACTIVE"] };
  }
  if (q.length > 0) {
    const searchClause = {
      OR: [
        { productName: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
      ],
    };
    where.AND = where.AND ? [...where.AND, searchClause] : [searchClause];
  }

  const [items, total] = await Promise.all([
    prisma.authProduct.findMany({
      where,
      select: { id: true, productName: true, sku: true, status: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.authProduct.count({ where }),
  ]);

  return {
    items: items.map((p) => ({
      id: p.id,
      name: p.productName,
      sku: p.sku,
      isActive: p.status === "ACTIVE",
      approvalStatus: p.status,
    })),
    page,
    limit,
    total,
  };
}

async function createProduct(userId, producerOrgId, data) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  if (!data.productName || !data.sku) {
    throw createError("productName and sku are required", 400);
  }
  return prisma.authProduct.create({
    data: {
      producerOrgId: Number(producerOrgId),
      brandName: data.brandName || "",
      productName: data.productName,
      sku: data.sku,
      packSize: data.packSize || null,
      description: data.description || null,
      status: "DRAFT",
      createdByUserId: userId,
    },
  });
}

async function getProduct(producerOrgId, id) {
  if (!producerOrgId) return null;
  return prisma.authProduct.findFirst({
    where: { id: Number(id), producerOrgId: Number(producerOrgId) },
    include: {
      proofs: {
        include: { media: { select: { id: true, url: true, type: true, mimeType: true } } },
      },
    },
  });
}

async function updateProduct(userId, producerOrgId, id, data) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(id), producerOrgId: Number(producerOrgId) },
  });
  if (!product) throw createError("Product not found", 404);

  return prisma.authProduct.update({
    where: { id: product.id },
    data: {
      ...(data.brandName !== undefined ? { brandName: String(data.brandName || "") } : {}),
      ...(data.productName !== undefined ? { productName: String(data.productName || "") } : {}),
      ...(data.sku !== undefined ? { sku: String(data.sku || "") } : {}),
      ...(data.packSize !== undefined ? { packSize: data.packSize ? String(data.packSize) : null } : {}),
      ...(data.description !== undefined ? { description: data.description ? String(data.description) : null } : {}),
      ...(data.specJson !== undefined ? { specJson: data.specJson } : {}),
      ...(data.factoryId !== undefined ? { factoryId: data.factoryId ? Number(data.factoryId) : null } : {}),
      ...(data.ownershipDeclarationAcceptedAt !== undefined
        ? {
            ownershipDeclarationAcceptedAt: data.ownershipDeclarationAcceptedAt
              ? new Date(data.ownershipDeclarationAcceptedAt)
              : null,
          }
        : {}),
      ...(userId ? { createdByUserId: product.createdByUserId || userId } : {}),
    },
  });
}

async function submitProduct(userId, producerOrgId, id) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(id), producerOrgId: Number(producerOrgId) },
  });
  if (!product) throw createError("Product not found", 404);

  return prisma.authProduct.update({
    where: { id: product.id },
    data: { status: "SUBMITTED", submittedAt: new Date(), createdByUserId: product.createdByUserId || userId },
  });
}

/**
 * Resubmit product after changes requested or rejection. Only allowed when status is CHANGES_REQUESTED or REJECTED.
 * Creates a revision snapshot, sets product to SUBMITTED, and upserts ProducerApproval to SUBMITTED.
 */
async function resubmitProduct(userId, producerOrgId, productId) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(productId), producerOrgId: Number(producerOrgId) },
    select: { id: true, status: true },
  });
  if (!product) throw createError("Product not found", 404);
  if (product.status !== "CHANGES_REQUESTED" && product.status !== "REJECTED") {
    throw createError(
      "Resubmit only allowed when product status is CHANGES_REQUESTED or REJECTED. Current: " + (product.status || "unknown"),
      400,
      "INVALID_STATE"
    );
  }

  const approvalPolicy = require("../../services/governance/approvalPolicy.service");
  await approvalPolicy.checkCanSubmit(prisma, producerOrgId, "PRODUCT", product.id, userId);

  const approvalService = require("./producerApproval.service");
  const productRevision = require("../../services/governance/productRevision.service");

  const approval = await prisma.producerApproval.findFirst({
    where: {
      producerOrgId: Number(producerOrgId),
      entityType: "PRODUCT",
      entityId: product.id,
    },
    select: { id: true },
  });

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const { revision } = await productRevision.createRevisionSnapshot(tx, {
      productId: product.id,
      submittedByUserId: userId,
      approvalId: approval?.id ?? undefined,
    });
    await tx.authProduct.update({
      where: { id: product.id },
      data: { status: "SUBMITTED", submittedAt: now },
    });
    const slaDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const updatedApproval = await tx.producerApproval.upsert({
      where: {
        producerOrgId_entityType_entityId: {
          producerOrgId: Number(producerOrgId),
          entityType: "PRODUCT",
          entityId: product.id,
        },
      },
      update: {
        status: "SUBMITTED",
        submittedByUserId: userId,
        reviewedByUserId: null,
        reviewedAt: null,
        note: null,
        slaDeadline,
      },
      create: {
        producerOrgId: Number(producerOrgId),
        entityType: "PRODUCT",
        entityId: product.id,
        status: "SUBMITTED",
        submittedByUserId: userId,
        slaDeadline,
      },
    });
    return { product: await tx.authProduct.findUnique({ where: { id: product.id } }), approval: updatedApproval, revision };
  });

  return result;
}

async function getProductStatus(producerOrgId, id) {
  if (!producerOrgId) return null;
  return prisma.authProduct.findFirst({
    where: { id: Number(id), producerOrgId: Number(producerOrgId) },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      reviewedAt: true,
      reviewedByAdminId: true,
      reviewNotes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

async function addProductProof(producerOrgId, userId, productId, data) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(productId), producerOrgId: Number(producerOrgId) },
  });
  if (!product) throw createError("Product not found", 404);

  return prisma.authProductProof.create({
    data: {
      authProductId: product.id,
      proofType: String(data.proofType),
      mediaId: Number(data.mediaId),
      metadataJson: data.metadataJson || null,
      labelHash: null,
      textFingerprint: null,
      ...(userId ? { createdAt: new Date() } : {}),
    },
  });
}

async function listFactories(producerOrgId) {
  if (!producerOrgId) return [];
  return prisma.producerFactory.findMany({
    where: { producerOrgId: Number(producerOrgId) },
    orderBy: { createdAt: "desc" },
  });
}

async function createFactory(producerOrgId, data) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  if (!data?.name) throw createError("name is required", 400);
  return prisma.producerFactory.create({
    data: {
      producerOrgId: Number(producerOrgId),
      name: String(data.name),
      addressJson: data.addressJson || null,
      countryCode: data.countryCode || null,
      isVerified: false,
    },
  });
}

async function createBatch(userId, producerOrgId, productId, data) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  await featureFlag.requireEnabled(prisma, Number(producerOrgId), "producer.batches.enabled");
  await quota.checkAndIncrement(prisma, Number(producerOrgId), "producer.batches.create.daily", 1);
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(productId), producerOrgId: Number(producerOrgId) },
  });
  if (!product) {
    throw createError("Product not found", 404);
  }
  if (product.status !== "ACTIVE") {
    throw createError("Product must be activated by platform admin before creating batches", 403);
  }
  if (!data.batchNo || !data.qtyPlanned) {
    throw createError("batchNo and qtyPlanned are required", 400);
  }
  return prisma.authBatch.create({
    data: {
      authProductId: product.id,
      batchNo: data.batchNo,
      mfgDate: data.mfgDate ? new Date(data.mfgDate) : null,
      expDate: data.expDate ? new Date(data.expDate) : null,
      qtyPlanned: Number(data.qtyPlanned),
      status: "DRAFT",
      createdByUserId: userId,
    },
  });
}

async function listBatches(producerOrgId, params: PaginationParams = {}) {
  if (!producerOrgId) return { items: [], pagination: { page: 1, limit: 20, total: 0 } };
  const take = Math.min(Number(params.limit) || 20, 100);
  const skip = (Number(params.page || 1) - 1) * take;
  const where = { authProduct: { producerOrgId: Number(producerOrgId) } };
  const [items, total] = await Promise.all([
    prisma.authBatch.findMany({ where, take, skip, orderBy: { createdAt: "desc" } }),
    prisma.authBatch.count({ where }),
  ]);
  return { items, pagination: { page: Number(params.page || 1), limit: take, total } };
}

/**
 * GET /print/batches: list batches for print view with code counts and serial state.
 * Same producer-org scope and same "issued" definition as getPrintBatchDetail:
 * issuedCount = BatchSerialState.allocatedCount (serials reserved via allocate/export).
 * Uses include serialState (same as detail) and an explicit BatchSerialState query keyed by
 * AuthBatch.id (batchId) so lookup matches regardless of number/string coercion.
 */
async function listPrintBatches(producerOrgId) {
  if (!producerOrgId) return { items: [], pagination: { page: 1, limit: 0, total: 0 } };
  const where = { authProduct: { producerOrgId: Number(producerOrgId) } };
  const batches = await prisma.authBatch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      authProduct: { select: { productName: true } },
      _count: { select: { codes: true } },
      serialState: true,
    },
  });
  const batchIds = batches.map((b) => Number(b.id));
  const serialStates =
    batchIds.length > 0
      ? await prisma.batchSerialState.findMany({
          where: { batchId: { in: batchIds } },
          select: { batchId: true, allocatedCount: true, lastAllocatedSerial: true },
        })
      : [];
  const serialStateMap = new Map(serialStates.map((s) => [Number(s.batchId), s]));
  const items = batches.map((b) => {
    const totalCodes = b._count?.codes ?? b.qtyGenerated ?? 0;
    const state = b.serialState ?? serialStateMap.get(Number(b.id));
    const allocatedCount = state?.allocatedCount ?? 0;
    const lastAllocatedSerial = state?.lastAllocatedSerial ?? 0;
    const remainingCount = Math.max(0, totalCodes - allocatedCount);
    const nextAvailableSerial = remainingCount > 0 ? lastAllocatedSerial + 1 : null;
    return {
      id: b.id,
      productName: b.authProduct?.productName ?? null,
      batchNo: b.batchNo,
      totalCodes,
      lastAllocatedSerial: lastAllocatedSerial || null,
      allocatedCount,
      remainingCount,
      nextAvailableSerial,
    };
  });
  return {
    items,
    pagination: { page: 1, limit: items.length, total: items.length },
  };
}

/**
 * GET /print/batches/:id: batch detail for print view with serial state and allocation logs.
 */
async function getPrintBatchDetail(producerOrgId, batchId) {
  if (!producerOrgId) return null;
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
    include: {
      authProduct: { select: { id: true, productName: true, sku: true } },
      _count: { select: { codes: true } },
      serialState: true,
      allocationLogs: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          allocatedBy: { select: { id: true, profile: true, auth: true } },
        },
      },
    },
  });
  if (!batch) return null;
  const totalCodes = batch._count?.codes ?? batch.qtyGenerated ?? 0;
  const state = batch.serialState;
  const allocatedCount = state?.allocatedCount ?? 0;
  const lastAllocatedSerial = state?.lastAllocatedSerial ?? 0;
  const remainingCount = Math.max(0, totalCodes - allocatedCount);
  const nextAvailableSerial = remainingCount > 0 ? lastAllocatedSerial + 1 : null;
  const logs = batch.allocationLogs || [];
  const lastIssuedLog = logs.find((l) => l.status === "ISSUED") || null;
  return {
    batch: {
      id: batch.id,
      batchNo: batch.batchNo,
      status: batch.status,
      qtyPlanned: batch.qtyPlanned,
      qtyGenerated: batch.qtyGenerated,
      createdAt: batch.createdAt,
      product: batch.authProduct,
    },
    totalCodes,
    lastAllocatedSerial: lastAllocatedSerial || null,
    allocatedCount,
    remainingCount,
    nextAvailableSerial: remainingCount > 0 ? nextAvailableSerial : null,
    allocationLogs: logs.map((log) => ({
      id: log.id,
      startSerial: log.startSerial,
      endSerial: log.endSerial,
      quantity: log.quantity,
      actionType: log.actionType,
      fileType: log.fileType,
      targetEmail: log.targetEmail,
      status: log.status,
      revokedAt: log.revokedAt,
      revokedByUserId: log.revokedByUserId,
      revokeReason: log.revokeReason,
      allocatedBy: log.allocatedBy
        ? { id: log.allocatedBy.id, displayName: log.allocatedBy.profile?.displayName || log.allocatedBy.auth?.email || String(log.allocatedBy.id) }
        : null,
      revokedBy: (log as any).revokedBy
        ? { id: (log as any).revokedBy.id, displayName: (log as any).revokedBy.profile?.displayName || (log as any).revokedBy.auth?.email || String((log as any).revokedBy.id) }
        : null,
      createdAt: log.createdAt,
    })),
    lastIssuedLog: lastIssuedLog
      ? {
          id: lastIssuedLog.id,
          startSerial: lastIssuedLog.startSerial,
          endSerial: lastIssuedLog.endSerial,
          quantity: lastIssuedLog.quantity,
          actionType: lastIssuedLog.actionType,
          createdAt: lastIssuedLog.createdAt,
        }
      : null,
  };
}

/**
 * GET /print/email-recipients: list saved email recipients for the producer org.
 */
async function listPrintEmailRecipients(producerOrgId) {
  if (!producerOrgId) return [];
  const rows = await prisma.producerEmailRecipient.findMany({
    where: { producerOrgId: Number(producerOrgId) },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, label: true },
  });
  return rows;
}

/**
 * POST /print/email-recipients: create (or return existing) saved recipient. Body: { email, label? }
 * Throws 400 INVALID_EMAIL on bad format; returns existing row if (producerOrgId, email) already exists.
 */
async function createPrintEmailRecipient(producerOrgId, userId, body) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const label = typeof body?.label === "string" ? body.label.trim() || null : null;
  if (!isValidEmail(email)) {
    const e = createError("Invalid email format", 400, "INVALID_EMAIL");
    throw e;
  }
  const existing = await prisma.producerEmailRecipient.findUnique({
    where: {
      producerOrgId_email: { producerOrgId: Number(producerOrgId), email },
    },
  });
  if (existing) {
    return existing;
  }
  const created = await prisma.producerEmailRecipient.create({
    data: {
      producerOrgId: Number(producerOrgId),
      email,
      label,
      createdByUserId: userId || null,
    },
    select: { id: true, email: true, label: true },
  });
  return created;
}

/** Get codes for a batch in serial order (id ASC); serial 1 = first code. Returns decrypted codes for the range [startSerial, endSerial] (1-based inclusive). */
async function getCodesForSerialRange(batchId, startSerial, endSerial) {
  const skip = Math.max(0, startSerial - 1);
  const take = Math.max(0, endSerial - startSerial + 1);
  const rows = await prisma.authCode.findMany({
    where: { batchId: Number(batchId) },
    orderBy: { id: "asc" },
    skip,
    take,
  });
  return rows.map((r) => decryptCode(r.codeCipher, r.codeIv, r.codeTag));
}

const ALLOCATION_ACTION_TYPES = ["PRINT", "DOWNLOAD_EXPORT", "EMAIL_EXPORT"];
const ALLOCATION_FILE_TYPES = ["CSV", "XLSX"];

/** Basic email format validation for export recipient. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s: string | null): boolean {
  return typeof s === "string" && s.length <= 254 && EMAIL_REGEX.test(s.trim());
}

/** Max EMAIL_EXPORT allocations per user per minute (rate limit). */
const EMAIL_EXPORT_RATE_LIMIT_PER_MINUTE = 5;

/**
 * POST /print/batches/:id/allocate
 * Body: { mode: "AUTO"|"RANGE", quantity?, startSerial?, endSerial?, actionType, fileType?, targetEmail? }
 * Allocates a serial range atomically and optionally generates export / sends email.
 */
async function allocatePrintBatch(producerOrgId, batchId, userId, body) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  await featureFlag.requireEnabled(prisma, Number(producerOrgId), "producer.printing.enabled");
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
    include: {
      _count: { select: { codes: true } },
      authProduct: { select: { productName: true } },
    },
  });
  if (!batch) throw createError("Batch not found", 404);
  await approvalPolicy.checkBatchApprovedForCodes(prisma, batch.id);
  await approvalPolicy.checkBatchNotQuarantinedOrFrozen(prisma, batch.id);

  const totalCodes = batch._count?.codes ?? batch.qtyGenerated ?? 0;
  if (totalCodes <= 0) throw createError("Batch has no codes to allocate", 400);

  let state = await prisma.batchSerialState.findUnique({ where: { batchId: batch.id } });
  if (!state) {
    state = await prisma.batchSerialState.create({
      data: { batchId: batch.id, lastAllocatedSerial: 0, allocatedCount: 0 },
    });
  }
  if (state.lastAllocatedSerial >= totalCodes) {
    throw createError("No serials remaining", 400, "NO_SERIALS_REMAINING");
  }

  const mode = (body.mode || "AUTO").toUpperCase();
  const actionType = String(body.actionType || "").toUpperCase();
  if (!ALLOCATION_ACTION_TYPES.includes(actionType)) {
    throw createError("actionType must be one of PRINT, DOWNLOAD_EXPORT, EMAIL_EXPORT", 400);
  }

  let startSerial: number;
  let endSerial: number;
  const nextAvailable = state.lastAllocatedSerial + 1;

  if (mode === "AUTO") {
    const quantity = Math.max(1, Number(body.quantity) || 1);
    startSerial = nextAvailable;
    endSerial = startSerial + quantity - 1;
    if (endSerial > totalCodes) {
      throw createError(`Only ${totalCodes - startSerial + 1} serial(s) remaining; requested ${quantity}`, 400);
    }
  } else if (mode === "RANGE") {
    startSerial = Number(body.startSerial);
    endSerial = Number(body.endSerial);
    if (!Number.isInteger(startSerial) || !Number.isInteger(endSerial) || startSerial < 1 || endSerial < startSerial) {
      throw createError("RANGE mode requires startSerial and endSerial (1-based, startSerial <= endSerial)", 400);
    }
    if (startSerial !== nextAvailable) {
      throw createError(`Next available serial is ${nextAvailable}; startSerial must match for sequential allocation`, 400);
    }
    if (endSerial > totalCodes) {
      throw createError(`endSerial must not exceed total codes (${totalCodes})`, 400);
    }
  } else {
    throw createError("mode must be AUTO or RANGE", 400);
  }

  const quantity = endSerial - startSerial + 1;
  const fileType = body.fileType ? String(body.fileType).toUpperCase() : null;
  const targetEmail = typeof body.targetEmail === "string" ? body.targetEmail.trim() : null;

  if ((actionType === "DOWNLOAD_EXPORT" || actionType === "EMAIL_EXPORT") && !["CSV", "XLSX"].includes(fileType)) {
    throw createError("fileType (CSV or XLSX) required for export actions", 400);
  }
  if (actionType === "EMAIL_EXPORT" && !targetEmail) {
    throw createError("targetEmail required for EMAIL_EXPORT", 400);
  }
  if (actionType === "EMAIL_EXPORT" && targetEmail && !isValidEmail(targetEmail)) {
    throw createError("Invalid email format for targetEmail", 400, "INVALID_EMAIL");
  }
  if (actionType === "EMAIL_EXPORT" && userId) {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentCount = await prisma.batchSerialAllocationLog.count({
      where: {
        allocatedByUserId: userId,
        actionType: "EMAIL_EXPORT",
        status: "ISSUED",
        createdAt: { gte: oneMinuteAgo },
      },
    });
    if (recentCount >= EMAIL_EXPORT_RATE_LIMIT_PER_MINUTE) {
      throw createError("Too many email exports; please try again in a minute", 429, "RATE_LIMIT");
    }
  }
  if (actionType === "EMAIL_EXPORT" && fileType === "XLSX") {
    throw createError("XLSX export is not yet implemented; use CSV", 400);
  }
  if (actionType === "DOWNLOAD_EXPORT" && fileType === "XLSX") {
    throw createError("XLSX export is not yet implemented; use CSV", 400);
  }

  const actionTypeEnum = actionType as "PRINT" | "DOWNLOAD_EXPORT" | "EMAIL_EXPORT";
  const logPayload = {
    batchId: batch.id,
    startSerial,
    endSerial,
    quantity,
    actionType: actionTypeEnum,
    fileType: fileType as "CSV" | "XLSX" | null,
    targetEmail: actionType === "EMAIL_EXPORT" ? targetEmail : null,
    allocatedByUserId: userId || null,
    status: "ISSUED" as const,
  };

  const skip = startSerial - 1;
  const take = quantity;
  const now = new Date();

  const { updatedState, log } = await prisma.$transaction(async (tx) => {
    const updatedState = await tx.batchSerialState.upsert({
      where: { batchId: batch.id },
      create: { batchId: batch.id, lastAllocatedSerial: endSerial, allocatedCount: quantity },
      update: { lastAllocatedSerial: endSerial, allocatedCount: { increment: quantity } },
    });
    const log = await tx.batchSerialAllocationLog.create({ data: logPayload });
    const codeRows = await tx.authCode.findMany({
      where: { batchId: batch.id },
      orderBy: { id: "asc" },
      skip,
      take,
      select: { id: true },
    });
    const codeIds = codeRows.map((r) => r.id);
    if (codeIds.length > 0) {
      await tx.authCode.updateMany({
        where: { id: { in: codeIds } },
        data: {
          issuedAt: now,
          issuedByUserId: userId || null,
          issuedMethod: actionTypeEnum,
          issuedToEmail: actionType === "EMAIL_EXPORT" ? targetEmail : null,
          issuedAllocationLogId: log.id,
        },
      });
    }
    return { updatedState, log };
  });

  const result: {
    startSerial: number;
    endSerial: number;
    quantity: number;
    nextAvailableSerial: number | null;
    allocationLogId: number;
  } = {
    startSerial,
    endSerial,
    quantity,
    nextAvailableSerial: updatedState.lastAllocatedSerial < totalCodes ? updatedState.lastAllocatedSerial + 1 : null,
    allocationLogId: log.id,
  };

  const productName = (batch as any).authProduct?.productName ?? "";
  const batchNo = batch.batchNo ?? "";
  const csvHeaders = ["serial", "code", "batchNo", "productName"];

  if (actionType === "DOWNLOAD_EXPORT" && fileType === "CSV") {
    const codes = await getCodesForSerialRange(batch.id, startSerial, endSerial);
    const rows = codes.map((code, i) => ({
      serial: startSerial + i,
      code,
      batchNo,
      productName,
    }));
    const csv = buildCsv(rows, csvHeaders, { useBom: true });
    const buffer = Buffer.from(csv, "utf-8");
    const filename = `producer-batch-${batchNo}-${startSerial}-${endSerial}.csv`;
    return { ...result, download: { contentType: "text/csv; charset=utf-8", filename, buffer } };
  }

  if (actionType === "EMAIL_EXPORT" && fileType === "CSV" && targetEmail) {
    const codes = await getCodesForSerialRange(batch.id, startSerial, endSerial);
    const rows = codes.map((code, i) => ({
      serial: startSerial + i,
      code,
      batchNo,
      productName,
    }));
    const csv = buildCsv(rows, csvHeaders, { useBom: true });
    const buffer = Buffer.from(csv, "utf-8");
    const filename = `producer-batch-${batchNo}-${startSerial}-${endSerial}.csv`;
    const { isSmtpEnabled, sendMailWithAttachment } = require("../../../../utils/smtpMailer");
    if (isSmtpEnabled()) {
      await sendMailWithAttachment({
        to: targetEmail,
        subject: `Batch ${batch.batchNo} codes ${startSerial}-${endSerial}`,
        html: `<p>Please find attached the allocated codes (serials ${startSerial}-${endSerial}) for batch ${batch.batchNo}.</p>`,
        text: `Attached: batch ${batch.batchNo} codes ${startSerial}-${endSerial}.`,
        attachments: [{ filename, content: buffer }],
      });
    }
    return { ...result, emailSent: true, targetEmail };
  }

  return result;
}

/**
 * GET /print/issuances/:issuanceId/download
 * Re-download serials for an ISSUED allocation. Validates producerOrg isolation; generates CSV from issuance start–end range; writes audit ISSUANCE_SERIAL_REDOWNLOADED.
 */
async function downloadIssuanceSerials(producerOrgId, issuanceId, userId, actorType) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const log = await prisma.batchSerialAllocationLog.findFirst({
    where: { id: Number(issuanceId) },
    include: {
      batch: {
        include: {
          authProduct: { select: { id: true, producerOrgId: true, productName: true } },
        },
      },
    },
  });
  if (!log || !log.batch) throw createError("Issuance not found", 404);
  const batch = log.batch as any;
  if (batch.authProduct?.producerOrgId !== Number(producerOrgId)) {
    throw createError("Issuance not found", 404);
  }
  if (log.status !== "ISSUED") {
    throw createError("Only issued allocations can be re-downloaded", 400, "ISSUANCE_NOT_ISSUED");
  }
  const productName = batch.authProduct?.productName ?? "";
  const batchNo = batch.batchNo ?? "";
  const csvHeaders = ["serial", "code", "batchNo", "productName"];
  const codes = await getCodesForSerialRange(batch.id, log.startSerial, log.endSerial);
  const rows = codes.map((code, i) => ({
    serial: log.startSerial + i,
    code,
    batchNo,
    productName,
  }));
  const csv = buildCsv(rows, csvHeaders, { useBom: true });
  const buffer = Buffer.from(csv, "utf-8");
  const filename = `producer-batch-${batchNo}-${log.startSerial}-${log.endSerial}.csv`;
  await writeProducerAudit({
    producerOrgId: Number(producerOrgId),
    actorType: actorType === "OWNER" ? "OWNER" : "STAFF",
    actorId: Number(userId),
    action: "ISSUANCE_SERIAL_REDOWNLOADED",
    entityType: "ISSUANCE",
    entityId: String(log.id),
  });
  return { contentType: "text/csv; charset=utf-8", filename, buffer };
}

/**
 * POST /print/batches/:batchId/allocations/:allocationId/revoke
 * Revoke an ISSUED allocation: mark log REVOKED and clear issued fields on codes. Does not change lastAllocatedSerial.
 * Caller must be producer owner and have producer.codes.revoke (enforced by route).
 */
async function revokePrintAllocation(producerOrgId, batchId, allocationId, userId, body) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
  });
  if (!batch) throw createError("Batch not found", 404);

  const allocation = await prisma.batchSerialAllocationLog.findFirst({
    where: { id: Number(allocationId), batchId: batch.id },
  });
  if (!allocation) throw createError("Allocation not found", 404);
  if (allocation.status !== "ISSUED") {
    throw createError("Allocation is not in ISSUED state and cannot be revoked", 409, "ALLOCATION_NOT_REVOCABLE");
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : null;

  const [updated] = await prisma.$transaction([
    prisma.batchSerialAllocationLog.update({
      where: { id: allocation.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByUserId: userId,
        revokeReason: reason,
      },
      include: {
        allocatedBy: { select: { id: true, profile: true, auth: true } },
        revokedBy: { select: { id: true, profile: true, auth: true } },
      },
    }),
    prisma.authCode.updateMany({
      where: { issuedAllocationLogId: allocation.id },
      data: {
        issuedAt: null,
        issuedByUserId: null,
        issuedMethod: null,
        issuedToEmail: null,
        issuedAllocationLogId: null,
      },
    }),
  ]);

  return {
    id: updated.id,
    batchId: updated.batchId,
    startSerial: updated.startSerial,
    endSerial: updated.endSerial,
    quantity: updated.quantity,
    actionType: updated.actionType,
    status: updated.status,
    revokedAt: updated.revokedAt,
    revokedByUserId: updated.revokedByUserId,
    revokeReason: updated.revokeReason,
    allocatedBy: updated.allocatedBy
      ? { id: updated.allocatedBy.id, displayName: (updated.allocatedBy as any).profile?.displayName || (updated.allocatedBy as any).auth?.email || String(updated.allocatedBy.id) }
      : null,
    revokedBy: updated.revokedBy
      ? { id: updated.revokedBy.id, displayName: (updated.revokedBy as any).profile?.displayName || (updated.revokedBy as any).auth?.email || String(updated.revokedBy.id) }
      : null,
    createdAt: updated.createdAt,
  };
}

async function getBatch(producerOrgId, id) {
  if (!producerOrgId) return null;
  return prisma.authBatch.findFirst({
    where: { id: Number(id), authProduct: { producerOrgId: Number(producerOrgId) } },
  });
}

async function getBatchWithCodes(producerOrgId, id, params: PaginationParams = {}) {
  if (!producerOrgId) return null;

  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(id), authProduct: { producerOrgId: Number(producerOrgId) } },
    include: { authProduct: true },
  });
  if (!batch) return null;

  const take = Math.min(Number(params.limit) || 50, 200);
  const page = Number(params.page) || 1;
  const skip = (page - 1) * take;
  const [items, total] = await Promise.all([
    prisma.authCode.findMany({
      where: { batchId: batch.id },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.authCode.count({ where: { batchId: batch.id } }),
  ]);

  const codes = items.map((c) => ({
    id: c.id,
    code: decryptCode(c.codeCipher, c.codeIv, c.codeTag),
    status: c.status,
    codeLength: c.codeLength,
    customPrefix: c.customPrefix,
    customSuffix: c.customSuffix,
    printedAt: c.printedAt,
    exportedAt: c.exportedAt,
    verifyCount: c.verifyCount,
    firstVerifiedAt: c.firstVerifiedAt,
    firstVerifiedCountry: c.firstVerifiedCountry,
    createdAt: c.createdAt,
  }));

  return {
    batch,
    codes: {
      items: codes,
      pagination: { page, limit: take, total },
    },
  };
}

async function generateCodes(userId, producerOrgId, batchId, quantity, options = {}) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
  });
  if (!batch) {
    throw createError("Batch not found", 404);
  }
  await approvalPolicy.checkBatchApprovedForCodes(prisma, batch.id);
  await approvalPolicy.checkBatchNotQuarantinedOrFrozen(prisma, batch.id);
  if (batch.status !== "APPROVED" && batch.status !== "GENERATED") {
    throw createError("Batch is not approved", 403);
  }
  const qty = Number(quantity);
  if (!qty || qty <= 0) {
    throw createError("quantity required", 400);
  }
  const planned = Number(batch.qtyPlanned || 0);
  const generated = Number(batch.qtyGenerated || 0);
  if (!Number.isFinite(planned) || planned <= 0) {
    throw createError("Batch planned quantity is invalid", 400);
  }
  if (generated + qty > planned) {
    throw createError("Requested quantity exceeds batch limit", 400);
  }

  const codes: string[] = [];
  let attempts = 0;
  const maxAttempts = Math.max(qty * 5, 20);

  while (codes.length < qty) {
    attempts += 1;
    if (attempts > maxAttempts) {
      throw createError("Failed to generate enough unique codes. Please retry.", 500);
    }

    const needed = qty - codes.length;
    const hashToCode = new Map<string, string>();
    const rows = [];

    while (rows.length < needed) {
      const built = buildPublicCode(options);
      const publicCode = built.code;
      const codeHash = hmacHash(publicCode);
      if (hashToCode.has(codeHash)) continue;
      const enc = encryptCode(publicCode);
      hashToCode.set(codeHash, publicCode);
      rows.push({
        batchId: batch.id,
        codeHash,
        codeLength: built.format.length,
        customPrefix: built.format.prefix,
        customSuffix: built.format.suffix,
        codeCipher: enc.cipher,
        codeIv: enc.iv,
        codeTag: enc.tag,
        status: "UNUSED",
        generatedByUserId: userId,
      });
    }

    const hashes = Array.from(hashToCode.keys());
    const existing = await prisma.authCode.findMany({
      where: { codeHash: { in: hashes } },
      select: { codeHash: true },
    });
    const existingSet = new Set(existing.map((e) => e.codeHash));
    const filteredRows = rows.filter((r) => !existingSet.has(r.codeHash));
    const filteredHashes = filteredRows.map((r) => r.codeHash);

    if (!filteredRows.length) continue;

    const createdCount = await prisma.$transaction(async (tx) => {
      const created = await tx.authCode.createMany({ data: filteredRows, skipDuplicates: true });
      if (created.count > 0) {
        await tx.authBatch.update({
          where: { id: batch.id },
          data: { qtyGenerated: { increment: created.count }, status: "GENERATED" },
        });
      }
      return created.count;
    });

    if (!createdCount) continue;

    const inserted = await prisma.authCode.findMany({
      where: { batchId: batch.id, codeHash: { in: filteredHashes } },
      select: { codeHash: true },
    });
    for (const row of inserted) {
      const code = hashToCode.get(row.codeHash);
      if (code) codes.push(code);
    }
  }

  return { codes };
}

/**
 * Record a batch print event: update printedAt, printedByUserId, increment printCount; write audit (BATCH_PRINTED or BATCH_REPRINTED).
 * Batch must be APPROVED or GENERATED. Optionally sets AuthCode.printedAt for codes in batch that have printedAt null.
 * @param actorType - "OWNER" | "STAFF" for audit log
 */
async function recordBatchPrint(producerOrgId, batchId, userId, actorType) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  await featureFlag.requireEnabled(prisma, Number(producerOrgId), "producer.printing.enabled");
  await quota.checkAndIncrement(prisma, Number(producerOrgId), "producer.print.daily", 1);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
  });
  if (!batch) throw createError("Batch not found", 404);
  if (batch.frozenAt) throw createError("Batch is frozen by admin.", 403, "BATCH_FROZEN");
  if (batch.status !== "APPROVED" && batch.status !== "GENERATED") {
    throw createError("Batch is not in a printable state. Approve the batch or generate codes first.", 400, "BATCH_NOT_PRINTABLE");
  }

  const now = new Date();
  const nextCount = (batch.printCount ?? 0) + 1;
  const action = nextCount === 1 ? "BATCH_PRINTED" : "BATCH_REPRINTED";
  const auditActorType = actorType === "OWNER" ? "OWNER" : "STAFF";

  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.authBatch.update({
      where: { id: batch.id },
      data: {
        printedAt: now,
        printedByUserId: userId,
        printCount: { increment: 1 },
      },
    });
    await tx.producerAuditLog.create({
      data: {
        producerOrgId: Number(producerOrgId),
        actorType: auditActorType,
        actorId: Number(userId),
        action,
        entityType: "AUTH_BATCH",
        entityId: String(batchId),
      },
    });
    await tx.authCode.updateMany({
      where: { batchId: batch.id, printedAt: null },
      data: { printedAt: now },
    });
    return b;
  });

  return {
    printedAt: updated.printedAt,
    printedByUserId: updated.printedByUserId,
    printCount: updated.printCount,
  };
}

async function exportCodes(producerOrgId, batchId) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
  });
  if (!batch) {
    throw createError("Batch not found", 404);
  }
  await approvalPolicy.checkBatchApprovedForCodes(prisma, batch.id);
  await approvalPolicy.checkBatchNotQuarantinedOrFrozen(prisma, batch.id);
  const rows = await prisma.authCode.findMany({ where: { batchId: batch.id } });
  const codes = rows.map((r) => decryptCode(r.codeCipher, r.codeIv, r.codeTag));
  await prisma.authCode.updateMany({
    where: { batchId: batch.id, exportedAt: null },
    data: { exportedAt: new Date() },
  });
  return { codes };
}

const BATCH_SUMMARY_CSV_HEADERS = [
  "batch_id", "batch_no", "producer_org_id", "producer_org_name", "factory_id", "factory_name",
  "product_id", "product_name", "product_sku", "product_brand", "product_category",
  "status", "mfg_date", "exp_date", "production_started_at", "production_completed_at", "created_at", "updated_at",
  "qty_planned", "qty_produced", "qty_rejected", "uom",
  "codes_total_generated", "codes_active", "codes_voided", "codes_last_generated_at",
  "qa_status", "qa_notes", "proofs_required", "proofs_uploaded_count", "compliance_ready",
  "export_version", "source_system", "source_env", "batch_url",
];

async function getBatchesSummaryForCsv(producerOrgId: number, filters: SummaryExportFilters = {}) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const org = await prisma.producerOrg.findUnique({
    where: { id: Number(producerOrgId) },
    select: { id: true, name: true },
  });
  if (!org) throw createError("Producer org not found", 404);

  const andClauses: Record<string, unknown>[] = [
    {
      authProduct: {
        producerOrgId: Number(producerOrgId),
        ...(filters.factoryId ? { factoryId: filters.factoryId } : {}),
        ...(filters.productId ? { id: filters.productId } : {}),
      },
    },
  ];
  if (filters.status && filters.status.length) {
    andClauses.push({ status: { in: filters.status } });
  }
  if (filters.createdFrom) {
    andClauses.push({ createdAt: { gte: filters.createdFrom } });
  }
  if (filters.createdTo) {
    andClauses.push({ createdAt: { lte: filters.createdTo } });
  }
  if (filters.mfgFrom) {
    andClauses.push({ mfgDate: { gte: filters.mfgFrom } });
  }
  if (filters.mfgTo) {
    andClauses.push({ mfgDate: { lte: filters.mfgTo } });
  }
  if (filters.search) {
    andClauses.push({
      OR: [
        { batchNo: { contains: filters.search, mode: "insensitive" } },
        { authProduct: { productName: { contains: filters.search, mode: "insensitive" } } },
        { authProduct: { sku: { contains: filters.search, mode: "insensitive" } } },
      ],
    });
  }

  const batches = await prisma.authBatch.findMany({
    where: { AND: andClauses as any },
    include: {
      authProduct: {
        include: {
          producerOrg: { select: { id: true, name: true } },
          factory: { select: { id: true, name: true } },
          proofs: { select: { id: true } },
        },
      },
      codes: { select: { id: true, status: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const sourceEnv = process.env.NODE_ENV === "production" ? "PROD" : "DEV";
  const baseUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || "";

  const rows = batches.map((b) => {
    const product = b.authProduct;
    const codes = b.codes || [];
    const lastCodeAt = codes.length ? codes.reduce((max, c) => (c.createdAt > max ? c.createdAt : max), codes[0].createdAt) : null;
    const activeCount = codes.filter((c) => c.status === "UNUSED" || c.status === "VERIFIED").length;
    const voidedCount = codes.filter((c) => c.status === "BLOCKED" || c.status === "EXPIRED").length;
    const batchUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/producer/batches/${b.id}` : "";
    return {
      batch_id: b.id,
      batch_no: b.batchNo || "",
      producer_org_id: org.id,
      producer_org_name: org.name || "",
      factory_id: product.factory?.id ?? "",
      factory_name: product.factory?.name ?? "",
      product_id: product.id,
      product_name: product.productName || "",
      product_sku: product.sku || "",
      product_brand: product.brandName || "",
      product_category: product.productType || "",
      status: (b.status || "DRAFT").toUpperCase(),
      mfg_date: formatDate(b.mfgDate),
      exp_date: formatDate(b.expDate),
      production_started_at: "",
      production_completed_at: "",
      created_at: formatIso(b.createdAt),
      updated_at: formatIso(b.updatedAt),
      qty_planned: b.qtyPlanned ?? 0,
      qty_produced: b.qtyGenerated ?? 0,
      qty_rejected: 0,
      uom: "PCS",
      codes_total_generated: codes.length,
      codes_active: activeCount,
      codes_voided: voidedCount,
      codes_last_generated_at: lastCodeAt ? formatIso(lastCodeAt) : "",
      qa_status: "",
      qa_notes: "",
      proofs_required: "true",
      proofs_uploaded_count: (product.proofs && product.proofs.length) || 0,
      compliance_ready: "false",
      export_version: "1.0",
      source_system: "BPA_WPA",
      sourceEnv,
      batch_url: batchUrl,
    };
  });

  const csv = buildCsv(rows, BATCH_SUMMARY_CSV_HEADERS);
  const filename = `batches_summary_${slugify(org.name)}_${filenameTimestamp().replace("_", "_")}.csv`;
  return { csv, filename };
}

const BATCH_CODES_CSV_HEADERS = [
  "batch_id", "batch_no", "product_id", "product_name", "factory_id", "factory_name",
  "code_id", "code_value", "code_format", "serial_no", "sequence_no",
  "code_status", "generated_at", "voided_at", "used_at", "expires_at",
  "checksum", "verification_url",
  "export_version", "source_system",
];

const CODES_STREAM_CHUNK_SIZE = 5000;

function buildCodesCsvRow(c, batch, sequenceNo, verificationBase) {
  const codeValue = decryptCode(c.codeCipher, c.codeIv, c.codeTag);
  const verificationUrl = verificationBase ? `${verificationBase}?code=${encodeURIComponent(codeValue)}` : "";
  return {
    batch_id: batch.id,
    batch_no: batch.batchNo || "",
    product_id: batch.authProduct.id,
    product_name: batch.authProduct.productName || "",
    factory_id: batch.authProduct.factory?.id ?? "",
    factory_name: batch.authProduct.factory?.name ?? "",
    code_id: c.id,
    code_value: codeValue,
    code_format: "ALPHANUM",
    serial_no: "",
    sequence_no: sequenceNo,
    code_status: (c.status || "UNUSED").toUpperCase(),
    generated_at: formatIso(c.createdAt),
    voided_at: "",
    used_at: c.firstVerifiedAt ? formatIso(c.firstVerifiedAt) : "",
    expires_at: "",
    checksum: "",
    verification_url: verificationUrl,
    export_version: "1.0",
    source_system: "BPA_WPA",
  };
}

async function getBatchCodesForCsv(producerOrgId, batchId) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
    include: {
      authProduct: {
        include: { factory: { select: { id: true, name: true } } },
      },
    },
  });
  if (!batch) throw createError("Batch not found", 404);

  const codeRows = await prisma.authCode.findMany({
    where: { batchId: batch.id },
    orderBy: { id: "asc" },
  });

  const baseUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || "";
  const verifyPath = "/verify";
  const verificationBase = baseUrl ? `${baseUrl.replace(/\/$/, "")}${verifyPath}` : "";

  const rows = codeRows.map((c, idx) => buildCodesCsvRow(c, batch, idx + 1, verificationBase));

  await prisma.authCode.updateMany({
    where: { batchId: batch.id, exportedAt: null },
    data: { exportedAt: new Date() },
  });

  const csv = buildCsv(rows, BATCH_CODES_CSV_HEADERS);
  const safeBatchNo = slugify(batch.batchNo) || `batch-${batch.id}`;
  const filename = `batch_codes_${safeBatchNo}_${filenameTimestamp().replace("_", "_")}.csv`;
  return { csv, filename };
}

/**
 * Stream batch codes CSV to res (cursor pagination, chunk-sized fetches). Does not load all codes into memory.
 * Sets Content-Type and Content-Disposition on res, writes BOM + header then rows in chunks, updates exportedAt per chunk.
 */
async function streamBatchCodesCsvToResponse(producerOrgId, batchId, res) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
    include: {
      authProduct: {
        include: { factory: { select: { id: true, name: true } } },
      },
    },
  });
  if (!batch) throw createError("Batch not found", 404);

  const baseUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || "";
  const verificationBase = baseUrl ? `${baseUrl.replace(/\/$/, "")}/verify` : "";
  const safeBatchNo = slugify(batch.batchNo) || `batch-${batch.id}`;
  const filename = `batch_codes_${safeBatchNo}_${filenameTimestamp()}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const headerLine = BATCH_CODES_CSV_HEADERS.map((h) => escapeCell(h)).join(",");
  res.write(UTF8_BOM + headerLine + "\n");

  let lastId = 0;
  let totalRows = 0;
  const startMs = Date.now();
  const isDev = process.env.NODE_ENV !== "production";

  while (true) {
    const chunk = await prisma.authCode.findMany({
      where: { batchId: batch.id, id: { gt: lastId } },
      orderBy: { id: "asc" },
      take: CODES_STREAM_CHUNK_SIZE,
    });
    if (chunk.length === 0) break;

    const ids = chunk.map((c) => c.id);
    lastId = ids[ids.length - 1];
    let sequenceStart = totalRows + 1;
    for (let i = 0; i < chunk.length; i++) {
      const row = buildCodesCsvRow(chunk[i], batch, sequenceStart + i, verificationBase);
      res.write(rowToCsvLine(row, BATCH_CODES_CSV_HEADERS) + "\n");
    }
    totalRows += chunk.length;

    await prisma.authCode.updateMany({
      where: { id: { in: ids } },
      data: { exportedAt: new Date() },
    });
  }

  res.end();
  if (isDev) {
    const ms = Date.now() - startMs;
    // eslint-disable-next-line no-console
    console.log(`[batch-codes-export] batchId=${batch.id} rows=${totalRows} ms=${ms}`);
  }
}

const BATCH_EVENTS_CSV_HEADERS = [
  "event_id", "batch_id", "batch_no", "event_type", "event_at", "actor_user_id", "actor_name", "actor_role",
  "field", "old_value", "new_value", "note", "export_version", "source_system",
];

async function getBatchEventsForCsv(producerOrgId, batchId) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
  });
  if (!batch) throw createError("Batch not found", 404);

  const auditLogs = await prisma.producerAuditLog.findMany({
    where: {
      producerOrgId: Number(producerOrgId),
      entityType: "AUTH_BATCH",
      entityId: String(batchId),
    },
    orderBy: { createdAt: "asc" },
  });

  const userIds = [...new Set(auditLogs.map((a) => a.actorId).filter(Boolean))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        include: { profile: { select: { displayName: true } } },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const rows = auditLogs.map((a) => {
    const u = userMap.get(a.actorId);
    return {
      event_id: a.id,
      batch_id: batch.id,
      batch_no: batch.batchNo || "",
      event_type: (a.action || "EVENT").toUpperCase(),
      event_at: formatIso(a.createdAt),
      actor_user_id: a.actorId ?? "",
      actor_name: (u as { profile?: { displayName?: string } })?.profile?.displayName ?? "",
      actor_role: (a.actorType || "").toUpperCase(),
      field: "",
      old_value: "",
      new_value: "",
      note: "",
      export_version: "1.0",
      source_system: "BPA_WPA",
    };
  });

  const csv = buildCsv(rows, BATCH_EVENTS_CSV_HEADERS);
  const safeBatchNo = slugify(batch.batchNo) || `batch-${batch.id}`;
  const filename = `batch_events_${safeBatchNo}_${filenameTimestamp().replace("_", "_")}.csv`;
  return { csv, filename };
}

async function verifyCode({ publicCode, ip, country, deviceId, userId }) {
  const masked = publicCode ? `${publicCode.slice(0, 4)}****${publicCode.slice(-2)}` : "INVALID";
  if (!publicCode) {
    await prisma.authVerificationLog.create({
      data: { publicCodeMasked: masked, ip, country, deviceId, userId: userId || null, result: "INVALID" },
    });
    return { status: "INVALID" };
  }
  const codeHash = hmacHash(publicCode);
  const code = await prisma.authCode.findUnique({
    where: { codeHash },
    include: { batch: { include: { authProduct: { include: { producerOrg: { select: { id: true, status: true } } } } } } },
  });
  if (!code) {
    await prisma.authVerificationLog.create({
      data: { publicCodeMasked: masked, ip, country, deviceId, userId: userId || null, result: "INVALID" },
    });
    return { status: "INVALID" };
  }
  if (code.status === "BLOCKED") {
    await prisma.authVerificationLog.create({
      data: { codeId: code.id, publicCodeMasked: masked, ip, country, deviceId, userId: userId || null, result: "BLOCKED" },
    });
    return { status: "BLOCKED" };
  }
  const batch = code.batch;
  const product = batch?.authProduct;
  const org = product?.producerOrg;
  const quarantinedAt = batch?.quarantinedAt ?? null;
  if (quarantinedAt) {
    await prisma.authVerificationLog.create({
      data: { codeId: code.id, publicCodeMasked: masked, ip, country, deviceId, userId: userId || null, result: "BLOCKED" },
    });
    return { status: "QUARANTINED", message: "Batch under investigation." };
  }
  if (product?.status === "INACTIVE") {
    await prisma.authVerificationLog.create({
      data: { codeId: code.id, publicCodeMasked: masked, ip, country, deviceId, userId: userId || null, result: "BLOCKED" },
    });
    return { status: "PRODUCT_INACTIVE", message: "Product not available." };
  }
  if (org?.status === "SUSPENDED") {
    await prisma.authVerificationLog.create({
      data: { codeId: code.id, publicCodeMasked: masked, ip, country, deviceId, userId: userId || null, result: "BLOCKED" },
    });
    return { status: "ORG_SUSPENDED", message: "Producer suspended." };
  }

  const status = code.verifyCount > 0 ? "ALREADY_VERIFIED" : "GENUINE";
  await prisma.$transaction(async (tx) => {
    await tx.authCode.update({
      where: { id: code.id },
      data: {
        verifyCount: { increment: 1 },
        ...(code.verifyCount === 0 ? { firstVerifiedAt: new Date(), firstVerifiedIp: ip || null, firstVerifiedCountry: country || null, status: "VERIFIED" } : {}),
      },
    });
    await tx.authVerificationLog.create({
      data: { codeId: code.id, publicCodeMasked: masked, ip, country, deviceId, userId: userId || null, result: status },
    });
  });

  return {
    status,
    product: {
      id: code.batch.authProduct.id,
      brandName: code.batch.authProduct.brandName,
      productName: code.batch.authProduct.productName,
      sku: code.batch.authProduct.sku,
      packSize: code.batch.authProduct.packSize,
    },
    batch: {
      id: code.batch.id,
      batchNo: code.batch.batchNo,
      mfgDate: code.batch.mfgDate,
      expDate: code.batch.expDate,
    },
  };
}

async function searchCode(producerOrgId, publicCode) {
  const code = String(publicCode || "").trim().toUpperCase();
  if (!code) {
    throw createError("code is required", 400);
  }
  if (code.length < 8 || code.length > 15) {
    throw createError("code length must be 8-15", 400);
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    throw createError("code must contain only A-Z and 0-9", 400);
  }

  if (!producerOrgId) throw createError("Producer org not found", 404);

  const codeHash = hmacHash(code);
  const row = await prisma.authCode.findFirst({
    where: { codeHash, batch: { authProduct: { producerOrgId: Number(producerOrgId) } } },
    include: { batch: { include: { authProduct: true } } },
  });
  if (!row) {
    throw createError("Code not found", 404);
  }

  return {
    id: row.id,
    code,
    status: row.status,
    isSold: row.status === "SOLD",
    isVerified: row.status === "VERIFIED",
    verifyCount: row.verifyCount,
    firstVerifiedAt: row.firstVerifiedAt,
    firstVerifiedCountry: row.firstVerifiedCountry,
    batch: {
      id: row.batch.id,
      batchNo: row.batch.batchNo,
      mfgDate: row.batch.mfgDate,
      expDate: row.batch.expDate,
    },
    product: {
      id: row.batch.authProduct.id,
      brandName: row.batch.authProduct.brandName,
      productName: row.batch.authProduct.productName,
      sku: row.batch.authProduct.sku,
      packSize: row.batch.authProduct.packSize,
    },
  };
}

// ==================== STAFF MANAGEMENT ====================

async function inviteStaff({ producerOrgId, invitedBy, email, phone, roleKey }) {
  const emailNorm = (email || "").trim().toLowerCase();
  const phoneNorm = (phone || "").trim().replace(/\D/g, "");

  if (!emailNorm && !phoneNorm) {
    throw createError("email or phone is required", 400);
  }

  // Find user by email or phone
  const auth = await prisma.userAuth.findFirst({
    where: {
      OR: [
        emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
        phoneNorm ? { phone: phoneNorm } : undefined,
      ].filter(Boolean),
    },
    select: { userId: true },
  });

  if (!auth) {
    throw createError("User not found with provided email/phone", 404);
  }

  // Check if already staff
  const existing = await prisma.producerOrgStaff.findUnique({
    where: {
      producerOrgId_userId: {
        producerOrgId,
        userId: auth.userId,
      },
    },
  });

  if (existing) {
    throw createError("User is already a staff member", 400);
  }

  // Get role
  const role = await prisma.role.findUnique({
    where: { key: roleKey || "PRODUCER_VIEWER" },
    select: { id: true },
  });

  if (!role) {
    throw createError("Invalid role", 400);
  }

  // Create staff membership
  return prisma.producerOrgStaff.create({
    data: {
      producerOrgId,
      userId: auth.userId,
      roleId: role.id,
      invitedBy,
    },
    include: {
      user: {
        include: {
          profile: true,
          auth: { select: { email: true, phone: true } },
        },
      },
      role: true,
    },
  });
}

async function listStaff(producerOrgId, opts) {
  const includeRemoved = opts?.includeRemoved === true;
  const where = includeRemoved
    ? { producerOrgId }
    : { producerOrgId, status: { not: "REMOVED" } };
  return prisma.producerOrgStaff.findMany({
    where,
    include: {
      user: {
        include: {
          profile: true,
          auth: { select: { email: true, phone: true } },
        },
      },
      role: true,
      inviter: {
        include: {
          profile: { select: { displayName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function getStaffMember(producerOrgId, staffId) {
  return prisma.producerOrgStaff.findFirst({
    where: { id: staffId, producerOrgId },
    include: { role: { select: { key: true } } },
  });
}

async function updateStaffRole(producerOrgId, staffId, roleKey) {
  const staff = await prisma.producerOrgStaff.findUnique({
    where: { id: staffId },
  });

  if (!staff || staff.producerOrgId !== producerOrgId) {
    throw createError("Staff not found", 404);
  }

  const role = await prisma.role.findUnique({
    where: { key: roleKey },
    select: { id: true },
  });

  if (!role) {
    throw createError("Invalid role", 400);
  }

  return prisma.producerOrgStaff.update({
    where: { id: staffId },
    data: { roleId: role.id },
    include: {
      user: {
        include: {
          profile: true,
          auth: { select: { email: true, phone: true } },
        },
      },
      role: true,
    },
  });
}

async function updateStaffStatus(producerOrgId, staffId, status) {
  const nextStatus = String(status || "").toUpperCase();
  const allowed = ["ACTIVE", "SUSPENDED", "DISABLED", "REMOVED"];
  if (!allowed.includes(nextStatus)) {
    throw createError("Invalid status", 400);
  }

  const staff = await prisma.producerOrgStaff.findUnique({
    where: { id: staffId },
  });
  if (!staff || staff.producerOrgId !== producerOrgId) {
    throw createError("Staff not found", 404);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.producerOrgStaff.update({
      where: { id: staffId },
      data: { status: nextStatus },
      include: {
        user: {
          include: {
            profile: true,
            auth: { select: { email: true, phone: true } },
          },
        },
        role: true,
        inviter: { include: { profile: { select: { displayName: true } } } },
      },
    });

    if (nextStatus !== "ACTIVE") {
      await tx.user.update({
        where: { id: row.userId },
        data: { tokenVersion: { increment: 1 } },
      });
    }

    return row;
  });

  return updated;
}

async function removeStaff(producerOrgId, staffId) {
  const staff = await prisma.producerOrgStaff.findUnique({
    where: { id: staffId },
  });

  if (!staff || staff.producerOrgId !== producerOrgId) {
    throw createError("Staff not found", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: staff.userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await tx.producerOrgStaff.delete({ where: { id: staffId } });
  });
}

/**
 * Trust & Safety: return active enforcement holds for producer org (and optionally product/batch).
 * Used by producer UI to show hold banners.
 */
async function getEnforcementHolds(prisma, producerOrgId, opts: { productId?: number; batchId?: number } = {}) {
  if (!producerOrgId) return { orgHold: null, productHold: null, batchHold: null };
  const where = {
    status: "APPLIED",
    case: { producerOrgId: Number(producerOrgId) },
  };
  const actions = await prisma.enforcementAction.findMany({
    where,
    include: { case: { select: { caseNo: true } } },
    orderBy: { appliedAt: "desc" },
  });
  let orgHold = null;
  let productHold = null;
  let batchHold = null;
  for (const a of actions) {
    if (a.targetType === "ORG" && String(a.targetId) === String(producerOrgId)) {
      if (!orgHold) orgHold = { caseNo: a.case?.caseNo ?? "" };
    }
    if (opts.productId != null && a.targetType === "PRODUCT" && String(a.targetId) === String(opts.productId)) {
      if (!productHold) productHold = { caseNo: a.case?.caseNo ?? "" };
    }
    if (opts.batchId != null && a.targetType === "BATCH" && String(a.targetId) === String(opts.batchId)) {
      if (!batchHold) batchHold = { caseNo: a.case?.caseNo ?? "" };
    }
  }
  return { orgHold, productHold, batchHold };
}

module.exports = {
  registerProducer,
  loginProducer,
  submitKyc,
  getKycStatus,
  getMe,
  listProducts,
  listProductsPick,
  createProduct,
  getProduct,
  updateProduct,
  submitProduct,
  resubmitProduct,
  getProductStatus,
  addProductProof,
  listFactories,
  createFactory,
  createBatch,
  listBatches,
  listPrintBatches,
  getPrintBatchDetail,
  listPrintEmailRecipients,
  createPrintEmailRecipient,
  allocatePrintBatch,
  revokePrintAllocation,
  downloadIssuanceSerials,
  getBatch,
  getBatchWithCodes,
  recordBatchPrint,
  generateCodes,
  exportCodes,
  parseSummaryExportFilters,
  getBatchesSummaryForCsv,
  getBatchCodesForCsv,
  streamBatchCodesCsvToResponse,
  getBatchEventsForCsv,
  verifyCode,
  searchCode,
  inviteStaff,
  listStaff,
  getStaffMember,
  updateStaffRole,
  updateStaffStatus,
  removeStaff,
  getEnforcementHolds,
};
export {};
