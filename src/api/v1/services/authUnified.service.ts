/**
 * Auth Unified Service – Single source of truth for auth flow.
 *
 * Adapter pattern: verifies credentials, resolves contexts, decides redirect.
 * Used by all login endpoints to ensure canonical response shape.
 *
 * @see docs/AUTH_ARCHITECTURE_SYSTEM_ANALYSIS.md
 * @legacy Preserves backward compatibility; adds canonical fields alongside legacy.
 */

const prisma = require("../../../infrastructure/db/prismaClient");
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

  const authRow = await prisma.userAuth.findFirst({
    where: {
      OR: [
        emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
        phoneNorm ? { phone: phoneNorm } : undefined,
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

/**
 * Check if user is allowed admin access (SuperAdminWhitelist or env fallback).
 */
async function isAdminAllowed(userId: number): Promise<boolean> {
  const auth = await prisma.userAuth.findUnique({
    where: { userId: Number(userId) },
    select: { phone: true, email: true },
  });

  const phoneDigits = normalizePhoneDigits(auth?.phone);
  const phoneLast11 = phoneDigits.length > 11 ? phoneDigits.slice(-11) : phoneDigits;
  const emailNorm = String(auth?.email || "").trim().toLowerCase();

  const hit = await prisma.superAdminWhitelist.findFirst({
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

  const allowIds = String(process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);
  if (allowIds.includes(Number(userId))) return true;

  const allowPhones = String(process.env.ADMIN_PHONES || "")
    .split(",")
    .map((x) => normalizePhoneDigits(x))
    .filter(Boolean);
  const allowEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);

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
  const ownerProfile = await prisma.ownerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  const ownedOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  const ownerKyc = await prisma.ownerKyc.findUnique({
    where: { userId },
    select: { verificationStatus: true },
  });
  const kycApproved =
    ownerKyc && ["VERIFIED", "APPROVED"].includes(String(ownerKyc.verificationStatus || "").toUpperCase());
  if (ownerProfile || ownedOrgs.length > 0 || kycApproved) {
    const scopeId = ownedOrgs[0]?.id ?? ownerProfile?.id ?? null;
    contexts.push({ role: "OWNER", scopeType: "OWNER", scopeId, status: "ACTIVE" });
  }

  // 3) Org members (non-owner)
  const orgMembers = await prisma.orgMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { orgId: true },
  });
  for (const om of orgMembers) {
    if (!ownedOrgs?.some((o) => o.id === om.orgId)) {
      contexts.push({ role: "STAFF", scopeType: "ORG", scopeId: om.orgId, status: "ACTIVE" });
    }
  }

  // 4) Branch members + access permission status
  const branchMembers = await prisma.branchMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { branchId: true },
  });
  for (const bm of branchMembers) {
    const perm = await prisma.branchAccessPermission.findUnique({
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
      status = "PENDING";
    }
    contexts.push({ role: "STAFF", scopeType: "BRANCH", scopeId: bm.branchId, status });
  }

  // 5) Country/State roles (map to ADMIN-like for country scope)
  const countryRoles = await prisma.userCountryRole.findMany({
    where: { userId },
    select: { countryId: true },
  });
  for (const cr of countryRoles) {
    contexts.push({ role: "ADMIN", scopeType: "ORG", scopeId: cr.countryId, status: "ACTIVE" });
  }

  // 6) Owner Team (delegate via UserContext - ownerUserId set, teamId set; not actual owner)
  const userContexts = await prisma.userContext.findMany({
    where: { userId },
    select: { ownerUserId: true, teamId: true },
  });
  const teamDelegate = userContexts.find((uc) => uc.ownerUserId != null && uc.teamId != null);
  if (teamDelegate && !contexts.some((c) => c.role === "OWNER")) {
    contexts.push({ role: "TEAM", scopeType: "OWNER", scopeId: teamDelegate.teamId, status: "ACTIVE" });
  }

  // 7) Producer (ProducerOrg owner or staff)
  const producerOrg = await prisma.producerOrg.findFirst({
    where: { ownerUserId: userId },
    select: { id: true, status: true },
  });
  if (producerOrg) {
    const status =
      producerOrg.status === "VERIFIED"
        ? "APPROVED"
        : producerOrg.status === "PENDING"
        ? "PENDING"
        : "ACTIVE";
    contexts.push({ role: "PRODUCER", scopeType: "OWNER", scopeId: producerOrg.id, status });
  }

  const producerStaff = await prisma.producerOrgStaff.findMany({
    where: { userId },
    select: { producerOrgId: true },
  });
  for (const ps of producerStaff) {
    if (!producerOrg || producerOrg.id !== ps.producerOrgId) {
      const org = await prisma.producerOrg.findUnique({
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
  const kyc = await prisma.ownerKyc.findUnique({
    where: { userId },
    select: { verificationStatus: true },
  });
  return kyc ? String(kyc.verificationStatus || "").toUpperCase() : null;
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
    const producerCtx = contexts.find((c) => c.role === "PRODUCER");
    if (producerCtx?.status === "PENDING") return "/producer/kyc";
    return "/producer";
  }
  if (options?.forceStaffPanel) {
    const staffBranch = contexts.find((c) => c.role === "STAFF" && c.scopeType === "BRANCH" && c.status === "APPROVED");
    if (staffBranch?.scopeId) return `/staff/branch/${staffBranch.scopeId}`;
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

  // Staff (branch)
  const approvedBranch = contexts.find((c) => c.role === "STAFF" && c.scopeType === "BRANCH" && c.status === "APPROVED");
  if (approvedBranch?.scopeId) return `/staff/branch/${approvedBranch.scopeId}`;
  const anyBranch = contexts.find((c) => c.role === "STAFF" && c.scopeType === "BRANCH");
  if (anyBranch?.status === "PENDING") return "/staff"; // access-request
  if (anyBranch) return "/staff";

  // Country admin
  if (contexts.some((c) => c.role === "ADMIN" && c.scopeType === "ORG")) {
    return "/country/dashboard";
  }

  // Customer fallback
  return "/mother";
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
