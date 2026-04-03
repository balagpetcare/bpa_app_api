/**
 * Auth Unified Service – Single source of truth for auth flow.
 *
 * Adapter pattern: verifies credentials, resolves contexts, decides redirect.
 * Used by all login endpoints to ensure canonical response shape.
 *
 * @see docs/AUTH_ARCHITECTURE_SYSTEM_ANALYSIS.md
 * @legacy Preserves backward compatibility; adds canonical fields alongside legacy.
 */

const db = require("../../../infrastructure/db/prismaClient");
const bcrypt = require("bcrypt");

/** Canonical AuthContext shape */
type AuthContext = {
  role: "ADMIN" | "OWNER" | "STAFF" | "PRODUCER" | "TEAM";
  scopeType: "GLOBAL" | "OWNER" | "BRANCH" | "ORG";
  scopeId?: number | null;
  status?: "PENDING" | "APPROVED" | "ACTIVE";
};

/** Canonical auth response shape (additive to legacy) */
type CanonicalAuthResponse = {
  user: { id: number; email: string | null };
  contexts: AuthContext[];
  default_redirect: string;
};

function normalizePhoneDigits(v: string | null | undefined): string {
  return String(v || "").replace(/\D/g, "");
}

/**
 * Verify credentials; returns authRow + user or throws.
 */
async function verifyCredentials(params: {
  email?: string | null;
  phone?: string | null;
  password: string;
}): Promise<{ authRow: any; user: any }> {
  const emailNorm = (params.email || "").trim().toLowerCase() || null;
  const phoneNorm = params.phone ? normalizePhoneDigits(params.phone) : null;

  if (!emailNorm && !phoneNorm) {
    throw Object.assign(new Error("email or phone is required"), { statusCode: 400 });
  }
  if (!params.password) {
    throw Object.assign(new Error("password is required"), { statusCode: 400 });
  }

  const phoneConditions: any[] = [];
  if (phoneNorm) {
    phoneConditions.push({ phone: phoneNorm });
    if (phoneNorm.length >= 11 && phoneNorm.startsWith("880")) {
      phoneConditions.push({ phone: phoneNorm.slice(-11) }); // BD: 8801777889994 → 01777889994
    }
  }

  const authRow = await db.userAuth.findFirst({
    where: {
      OR: [
        emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
        ...phoneConditions,
      ].filter(Boolean) as any[],
    },
    include: {
      user: { include: { profile: true, wallet: true } },
    },
  });

  if (!authRow || !authRow.user) {
    throw Object.assign(new Error("User not found"), { statusCode: 400 });
  }

  const storedHash = authRow.passwordHash || authRow.password;
  if (!storedHash) {
    throw Object.assign(new Error("Password not set for this user"), { statusCode: 500 });
  }

  const isMatch = await bcrypt.compare(params.password, storedHash);
  if (!isMatch) {
    throw Object.assign(new Error("Invalid credentials"), { statusCode: 400 });
  }

  return { authRow, user: authRow.user };
}

function normalizeEmail(v: string | null | undefined): string {
  return String(v || "").trim().toLowerCase();
}

function parseAdminEmailsEnv(): string[] {
  const raw = process.env.ADMIN_EMAILS || process.env.SUPER_ADMIN_WHITELIST_EMAILS || "";
  return String(raw)
    .split(",")
    .map((x) => normalizeEmail(x))
    .filter(Boolean);
}

function parseAdminPhonesEnv(): string[] {
  const raw = process.env.ADMIN_PHONES || process.env.SUPER_ADMIN_WHITELIST_PHONES || "";
  return String(raw)
    .split(",")
    .map((x) => normalizePhoneDigits(x))
    .filter(Boolean);
}

/**
 * Check if user is allowed admin access.
 * Uses SuperAdminWhitelist when table has rows; otherwise ADMIN_EMAILS/ADMIN_PHONES.
 * Also tries env fallback when DB has rows but no match (format mismatch / stale data).
 */
async function isAdminAllowed(userId: number): Promise<boolean> {
  const auth = await db.userAuth.findUnique({
    where: { userId: Number(userId) },
    select: { phone: true, email: true },
  });

  const phoneDigits = normalizePhoneDigits(auth?.phone);
  const phoneLast11 = phoneDigits.length > 11 ? phoneDigits.slice(-11) : phoneDigits;
  const emailNorm = normalizeEmail(auth?.email);

  const allowEmails = parseAdminEmailsEnv();
  const allowPhones = parseAdminPhonesEnv();

  if (!phoneDigits && !emailNorm) return false;

  const whitelistCount = await db.superAdminWhitelist.count({
    where: { isActive: true },
  });

  if (whitelistCount > 0) {
    const hit = await db.superAdminWhitelist.findFirst({
      where: {
        isActive: true,
        OR: [
          emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
          phoneDigits ? { phone: phoneDigits } : undefined,
          phoneLast11 ? { phone: phoneLast11 } : undefined,
        ].filter(Boolean) as any[],
      },
      select: { id: true },
    });
    if (hit) return true;
  }

  // Env fallback (when whitelist empty OR when DB had no match)
  const allowIds = String(process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);
  if (allowIds.includes(Number(userId))) return true;

  if (allowPhones.length && phoneDigits && allowPhones.includes(phoneDigits)) return true;
  if (allowPhones.length && phoneLast11 && allowPhones.includes(phoneLast11)) return true;
  if (allowEmails.length && emailNorm && allowEmails.includes(emailNorm)) return true;

  return false;
}

/**
 * Resolve all auth contexts for a user from DB.
 */
async function resolveAuthContexts(userId: number): Promise<AuthContext[]> {
  const contexts: AuthContext[] = [];

  // 1) Admin (SuperAdminWhitelist)
  const isAdmin = await isAdminAllowed(userId);
  if (isAdmin) {
    contexts.push({ role: "ADMIN", scopeType: "GLOBAL", scopeId: null, status: "ACTIVE" });
  }

  // 2) Owner (OwnerProfile + owned orgs + approved KYC)
  const ownerProfile = await db.ownerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  const ownedOrgs = await db.organization.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  const ownerKyc = await db.ownerKyc.findUnique({
    where: { userId },
    select: { verificationStatus: true },
  });
  const kycApproved =
    ownerKyc && ["VERIFIED", "APPROVED"].includes(String(ownerKyc.verificationStatus || "").toUpperCase());
  // Grant OWNER context if user has OwnerProfile, owned orgs, approved KYC, or any OwnerKyc row (draft/submitted)
  if (ownerProfile || ownedOrgs.length > 0 || kycApproved || ownerKyc) {
    const scopeId = ownedOrgs[0]?.id ?? ownerProfile?.id ?? null;
    contexts.push({ role: "OWNER", scopeType: "OWNER", scopeId, status: "ACTIVE" });
  }

  // 3) Org members (non-owner)
  const orgMembers = await db.orgMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  for (const om of orgMembers) {
    if (!ownedOrgs?.some((o) => o.id === om.orgId)) {
      contexts.push({ role: "STAFF", scopeType: "ORG", scopeId: om.orgId, status: "ACTIVE" });
    }
  }

  // 4) Branch members + access permission status
  const branchMembers = await db.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true },
  });
  for (const bm of branchMembers) {
    const perm = await db.branchAccessPermission.findUnique({
      where: {
        branchId_userId: { branchId: bm.branchId, userId },
      },
      select: { status: true, expiresAt: true },
    });
    let status: "PENDING" | "APPROVED" | "ACTIVE" = "ACTIVE";
    if (perm) {
      if (perm.status === "APPROVED") {
        status = perm.expiresAt && new Date(perm.expiresAt) < new Date() ? "PENDING" : "APPROVED";
      } else {
        status = perm.status === "PENDING" ? "PENDING" : "ACTIVE";
      }
    } else {
      // Legacy: No branchAccessPermission record but branch member is ACTIVE
      // Treat as ACTIVE for backward compatibility
      status = "ACTIVE";
    }
    contexts.push({ role: "STAFF", scopeType: "BRANCH", scopeId: bm.branchId, status });
  }

  // 5) Country/State roles (map to ADMIN-like for country scope)
  const countryRoles = await db.userCountryRole.findMany({
    where: { userId },
    select: { countryId: true },
  });
  for (const cr of countryRoles) {
    contexts.push({ role: "ADMIN", scopeType: "ORG", scopeId: cr.countryId, status: "ACTIVE" });
  }

  // 6) Owner Team (delegate via UserContext - ownerUserId set, teamId set; not actual owner)
  const userContexts = await db.userContext.findMany({
    where: { userId },
    select: { ownerUserId: true, teamId: true },
  });
  const teamDelegate = userContexts.find((uc) => uc.ownerUserId != null && uc.teamId != null);
  if (teamDelegate && !contexts.some((c) => c.role === "OWNER")) {
    contexts.push({ role: "TEAM", scopeType: "OWNER", scopeId: teamDelegate.teamId, status: "ACTIVE" });
  }

  // 7) Producer (ProducerOrg owner or staff)
  // Owner: use VerificationCase (PRODUCER_ORG) for redirect; fallback to ProducerOrg.status
  const producerOrg = await db.producerOrg.findFirst({
    where: { ownerUserId: userId },
    select: { id: true, status: true },
  });
  if (producerOrg) {
    const latestCase = await db.verificationCase.findFirst({
      where: { entityType: "PRODUCER_ORG", entityId: producerOrg.id },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    const caseStatus = latestCase?.status;
    const status =
      caseStatus === "APPROVED"
        ? "APPROVED"
        : caseStatus === "DRAFT" || caseStatus === "SUBMITTED" || caseStatus === "REJECTED" || !caseStatus
        ? "PENDING"
        : producerOrg.status === "VERIFIED"
        ? "APPROVED"
        : producerOrg.status === "PENDING"
        ? "PENDING"
        : "ACTIVE";
    contexts.push({ role: "PRODUCER", scopeType: "OWNER", scopeId: producerOrg.id, status });
  }

  const producerStaff = await db.producerOrgStaff.findMany({
    where: { userId, status: "ACTIVE" },
    select: { producerOrgId: true },
  });
  for (const ps of producerStaff) {
    if (!producerOrg || producerOrg.id !== ps.producerOrgId) {
      const org = await db.producerOrg.findUnique({
        where: { id: ps.producerOrgId },
        select: { status: true },
      });
      const status = org?.status === "VERIFIED" ? "APPROVED" : org?.status === "PENDING" ? "PENDING" : "ACTIVE";
      contexts.push({ role: "PRODUCER", scopeType: "ORG", scopeId: ps.producerOrgId, status });
    }
  }

  return contexts;
}

/**
 * Derive primary role from contexts for legacy req.user.role.
 * Priority: ADMIN > OWNER > PRODUCER > STAFF > USER
 */
function getPrimaryRoleFromContexts(contexts: AuthContext[]): string {
  if (contexts.some((c) => c.role === "ADMIN" && c.scopeType === "GLOBAL")) return "ADMIN";
  if (contexts.some((c) => c.role === "OWNER")) return "OWNER";
  if (contexts.some((c) => c.role === "PRODUCER")) return "PRODUCER";
  if (contexts.some((c) => c.role === "STAFF")) return "STAFF";
  return "USER";
}

/**
 * Attach req.contexts and req.user.role (legacy) for an authenticated user.
 * Call after req.user.id is set.
 */
async function attachAuthContexts(req: any, userId: number): Promise<void> {
  const contexts = await resolveAuthContexts(userId);
  req.contexts = contexts;
  req.user = req.user || {};
  req.user.role = req.user.role || getPrimaryRoleFromContexts(contexts);
}

/**
 * Get Owner KYC status for redirect logic.
 */
async function getOwnerKycStatus(userId: number): Promise<string | null> {
  const kyc = await db.ownerKyc.findUnique({
    where: { userId },
    select: { verificationStatus: true },
  });
  return kyc ? String(kyc.verificationStatus || "").toUpperCase() : null;
}

function normalizeBranchTypeCode(branch: any): string {
  const codeFromTypes = branch?.types?.[0]?.type?.code;
  return String(codeFromTypes || branch?.type || "").toUpperCase();
}

function isWarehouseBranchTypeCode(code: string): boolean {
  const normalized = String(code || "").toUpperCase();
  return [
    "WAREHOUSE",
    "CENTRAL_WAREHOUSE",
    "WAREHOUSE_DC",
    "DISTRIBUTION_CENTER",
    "DELIVERY_HUB",
    "HUB",
    "DELIVERY",
  ].includes(normalized);
}

async function resolveStaffBranchRedirect(userId: number, branchId: number): Promise<string> {
  if (!branchId) return "/staff";
  try {
    const branch = await db.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        types: { select: { type: { select: { code: true } } } },
        inventoryLocations: {
          where: { isActive: true },
          select: { id: true, warehouseId: true },
        },
      },
    });
    if (!branch) return `/staff/branch/${branchId}`;

    const branchTypeCode = normalizeBranchTypeCode(branch);
    const hasLinkedWarehouseLocation = Array.isArray(branch.inventoryLocations)
      ? branch.inventoryLocations.some((x: any) => Number(x?.warehouseId) > 0)
      : false;

    const wsaAtBranch = await db.warehouseStaffAssignment.findFirst({
      where: { userId, isActive: true, warehouse: { branchId, isActive: true } },
      select: { id: true },
    });
    if (wsaAtBranch) {
      return `/staff/branch/${branchId}/warehouse`;
    }

    const { resolvePermissionsForUser } = require("../utils/permissions");
    const perms = await resolvePermissionsForUser(userId).catch(() => []);
    const permSet = new Set(Array.isArray(perms) ? perms : []);
    const hasWarehousePerm =
      permSet.has("warehouse.view") ||
      permSet.has("warehouse.dashboard.view") ||
      permSet.has("dispatch.view") ||
      permSet.has("delivery.view") ||
      permSet.has("inventory.receive") ||
      permSet.has("warehouse.pick.execute");

    if (isWarehouseBranchTypeCode(branchTypeCode) || hasLinkedWarehouseLocation || hasWarehousePerm) {
      return `/staff/branch/${branchId}/warehouse`;
    }
    return `/staff/branch/${branchId}`;
  } catch {
    return `/staff/branch/${branchId}`;
  }
}

/**
 * Decide default_redirect based on contexts, KYC, and options.
 * Backend is the single source of truth for redirect.
 */
async function decideRedirect(
  userId: number,
  contexts: AuthContext[],
  options?: {
    forceStaffPanel?: boolean;
    forceAdminPanel?: boolean;
    forceProducerPanel?: boolean;
  }
): Promise<string> {
  const kycStatus = contexts.some((c) => c.role === "OWNER") ? await getOwnerKycStatus(userId) : null;

  // Force flags (e.g. staff login endpoint → staff panel)
  if (options?.forceAdminPanel) {
    return "/admin";
  }
  if (options?.forceProducerPanel) {
    const producerOwnerCtx = contexts.find((c) => c.role === "PRODUCER" && c.scopeType === "OWNER");
    if (producerOwnerCtx?.status === "PENDING") return "/producer/kyc";
    return "/producer/dashboard";
  }
  if (options?.forceStaffPanel) {
    // Accept both APPROVED and ACTIVE status for staff branch access
    const staffBranch = contexts.find((c) => c.role === "STAFF" && c.scopeType === "BRANCH" && (c.status === "APPROVED" || c.status === "ACTIVE"));
    if (staffBranch?.scopeId) return resolveStaffBranchRedirect(userId, Number(staffBranch.scopeId));
    const pendingBranch = contexts.find((c) => c.role === "STAFF" && c.scopeType === "BRANCH" && c.status === "PENDING");
    if (pendingBranch) return "/staff"; // access-request handled by frontend /staff UX
    return "/staff";
  }

  // Admin
  if (contexts.some((c) => c.role === "ADMIN" && c.scopeType === "GLOBAL")) {
    return "/admin";
  }

  // Owner + KYC
  if (contexts.some((c) => c.role === "OWNER")) {
    if (kycStatus === "UNSUBMITTED" || kycStatus === "REJECTED") return "/owner/kyc";
    return "/owner/dashboard";
  }

  // Team (delegate - never KYC)
  if (contexts.some((c) => c.role === "TEAM")) {
    return "/owner/workspace";
  }

  // Producer
  const producerCtx = contexts.find((c) => c.role === "PRODUCER");
  if (producerCtx) {
    if (producerCtx.status === "PENDING") return "/producer/kyc";
    return "/producer";
  }

  // Staff (branch) - also accept ACTIVE status for legacy compatibility
  const approvedBranch = contexts.find((c) => c.role === "STAFF" && c.scopeType === "BRANCH" && (c.status === "APPROVED" || c.status === "ACTIVE"));
  if (approvedBranch?.scopeId) return resolveStaffBranchRedirect(userId, Number(approvedBranch.scopeId));
  const anyBranch = contexts.find((c) => c.role === "STAFF" && c.scopeType === "BRANCH");
  if (anyBranch?.status === "PENDING") return "/staff"; // access-request
  if (anyBranch) return "/staff";

  // Country admin
  if (contexts.some((c) => c.role === "ADMIN" && c.scopeType === "ORG")) {
    return "/country/dashboard";
  }

  // Customer fallback: send to choose-activity instead of /mother
  return "/choose-activity";
}

/**
 * Build canonical auth response (additive to legacy payload).
 */
function buildCanonicalPayload(
  user: { id: number; auth?: { email?: string | null } | null },
  contexts: AuthContext[],
  default_redirect: string
): CanonicalAuthResponse {
  return {
    user: {
      id: user.id,
      email: user.auth?.email ?? null,
    },
    contexts,
    default_redirect,
  };
}

/**
 * Unified login: verify credentials, resolve contexts, decide redirect.
 * Returns everything needed to build response; does not set cookie or sign JWT.
 */
async function performUnifiedLogin(params: {
  email?: string | null;
  phone?: string | null;
  password: string;
  options?: {
    staffOnly?: boolean;
    adminOnly?: boolean;
    producerOnly?: boolean;
  };
}): Promise<{
  authRow: any;
  user: any;
  contexts: AuthContext[];
  default_redirect: string;
}> {
  const { authRow, user } = await verifyCredentials(params);

  if (params.options?.adminOnly) {
    const ok = await isAdminAllowed(user.id);
    if (!ok) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
  }

  if (params.options?.staffOnly) {
    const contexts = await resolveAuthContexts(user.id);
    const hasStaff =
      contexts.some((c) => c.role === "OWNER") ||
      contexts.some((c) => c.role === "STAFF" && c.scopeType === "BRANCH") ||
      contexts.some((c) => c.role === "STAFF" && c.scopeType === "ORG");
    if (!hasStaff) {
      throw Object.assign(new Error("This account does not have staff access. Please use owner login if you are an owner."), {
        statusCode: 403,
      });
    }
  }

  if (params.options?.producerOnly) {
    const contexts = await resolveAuthContexts(user.id);
    const hasProducer = contexts.some((c) => c.role === "PRODUCER");
    if (!hasProducer) {
      throw Object.assign(new Error("This account does not have producer access."), { statusCode: 403 });
    }
  }

  const contexts = await resolveAuthContexts(user.id);
  const default_redirect = await decideRedirect(user.id, contexts, {
    forceStaffPanel: params.options?.staffOnly,
    forceAdminPanel: params.options?.adminOnly,
    forceProducerPanel: params.options?.producerOnly,
  });

  return { authRow, user, contexts, default_redirect };
}

// CommonJS export for require()
module.exports = {
  verifyCredentials,
  isAdminAllowed,
  resolveAuthContexts,
  decideRedirect,
  buildCanonicalPayload,
  performUnifiedLogin,
  attachAuthContexts,
};
