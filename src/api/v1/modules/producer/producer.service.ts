const prisma = require("../../../../infrastructure/db/prismaClient");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");
const { resolvePermissionsForUser } = require("../../utils/permissions");
const { hmacHash, encryptCode, decryptCode } = require("../../utils/authCodeHasher");
const crypto = require("crypto");

type AppError = Error & { statusCode?: number };

type PaginationParams = {
  page?: string | number;
  limit?: string | number;
};

function createError(message: string, statusCode: number): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  return err;
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
  return { user, org };
}

async function listProducts(producerOrgId) {
  if (!producerOrgId) return [];
  return prisma.authProduct.findMany({
    where: { producerOrgId: Number(producerOrgId) },
    orderBy: { createdAt: "desc" },
  });
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
      status: "ACTIVE",
      createdByUserId: userId,
    },
  });
}

async function getProduct(producerOrgId, id) {
  if (!producerOrgId) return null;
  return prisma.authProduct.findFirst({ where: { id: Number(id), producerOrgId: Number(producerOrgId) } });
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
  const product = await prisma.authProduct.findFirst({
    where: { id: Number(productId), producerOrgId: Number(producerOrgId) },
  });
  if (!product) {
    throw createError("Product not found", 404);
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
      status: "APPROVED",
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

async function exportCodes(producerOrgId, batchId) {
  if (!producerOrgId) throw createError("Producer org not found", 404);
  const batch = await prisma.authBatch.findFirst({
    where: { id: Number(batchId), authProduct: { producerOrgId: Number(producerOrgId) } },
  });
  if (!batch) {
    throw createError("Batch not found", 404);
  }
  const rows = await prisma.authCode.findMany({ where: { batchId: batch.id } });
  const codes = rows.map((r) => decryptCode(r.codeCipher, r.codeIv, r.codeTag));
  await prisma.authCode.updateMany({
    where: { batchId: batch.id, exportedAt: null },
    data: { exportedAt: new Date() },
  });
  return { codes };
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
    include: { batch: { include: { authProduct: true } } },
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

async function listStaff(producerOrgId) {
  return prisma.producerOrgStaff.findMany({
    where: { producerOrgId },
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

module.exports = {
  registerProducer,
  loginProducer,
  submitKyc,
  getKycStatus,
  getMe,
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  submitProduct,
  getProductStatus,
  addProductProof,
  listFactories,
  createFactory,
  createBatch,
  listBatches,
  getBatch,
  getBatchWithCodes,
  generateCodes,
  exportCodes,
  verifyCode,
  searchCode,
  inviteStaff,
  listStaff,
  updateStaffRole,
  updateStaffStatus,
  removeStaff,
};
export {};
