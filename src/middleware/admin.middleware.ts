const prisma = require("../infrastructure/db/prismaClient");

function normalizePhoneDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function parseAdminEmails() {
  const raw = process.env.ADMIN_EMAILS || process.env.SUPER_ADMIN_WHITELIST_EMAILS || "";
  return parseCsv(raw)
    .map((x) => normalizeEmail(x))
    .filter(Boolean);
}

function parseAdminPhones() {
  const raw = process.env.ADMIN_PHONES || process.env.SUPER_ADMIN_WHITELIST_PHONES || "";
  return parseCsv(raw)
    .map((x) => normalizePhoneDigits(x))
    .filter(Boolean);
}

function parseAdminUserIds() {
  return parseCsv(process.env.ADMIN_USER_IDS || "")
    .map((x) => Number(x))
    .filter(Boolean);
}

function isDevEnv() {
  return String(process.env.NODE_ENV || "development") !== "production";
}

function normalizePerms(perms) {
  if (!Array.isArray(perms)) return [];
  return perms.map((p) => String(p));
}

function hasGovernancePermissionGrant(perms) {
  if (perms.has("global.admin") || perms.has("country.admin")) return true;
  if (perms.has("admin.producers.read")) return true;
  if (perms.has("admin.producers.write")) return true;
  if (perms.has("admin.approvals.manage")) return true;
  if (perms.has("admin.audit.read")) return true;
  return false;
}

async function isAdminUser(userId) {
  const auth = await prisma.userAuth.findUnique({
    where: { userId: Number(userId) },
    select: { phone: true, email: true },
  });

  const phoneDigits = normalizePhoneDigits(auth?.phone);
  const phoneLast11 = phoneDigits.length > 11 ? phoneDigits.slice(-11) : phoneDigits;
  const emailNorm = normalizeEmail(auth?.email);

  if (!phoneDigits && !emailNorm) return false;

  // Prefer SuperAdminWhitelist when table has rows; if no DB match, fallback to env allowlist.
  const whitelistCount = await prisma.superAdminWhitelist.count({
    where: { isActive: true },
  });

  if (whitelistCount > 0) {
    const hit = await prisma.superAdminWhitelist.findFirst({
      where: {
        isActive: true,
        OR: [
          emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
          phoneDigits ? { phone: phoneDigits } : undefined,
          phoneLast11 ? { phone: phoneLast11 } : undefined,
        ].filter(Boolean),
      },
      select: { id: true },
    });
    if (hit) return true;
  }

  // Env fallback when SuperAdminWhitelist is empty OR DB whitelist had no match.
  const allowIds = parseAdminUserIds();
  if (allowIds.includes(Number(userId))) return true;

  const allowPhones = parseAdminPhones();
  const allowEmails = parseAdminEmails();

  if (allowPhones.length && phoneDigits && allowPhones.includes(phoneDigits)) return true;
  if (allowPhones.length && phoneLast11 && allowPhones.includes(phoneLast11)) return true;
  if (allowEmails.length && emailNorm && allowEmails.includes(emailNorm)) return true;

  return false;
}

/** Admin panel permission keys (Governance). Whitelisted admins get these so requirePermission() passes on admin routes. */
const ADMIN_PANEL_PERMISSIONS = [
  "admin.producers.read",
  "admin.producers.write",
  "admin.approvals.manage",
  "admin.kyc.manage",
  "admin.audit.read",
  "admin.permissions.read",
];

module.exports = async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const reqPerms = new Set(normalizePerms(req.user?.permissions || req.user?.perms));
    const path = String(req.originalUrl || req.url || "");
    const isGovernanceRoute =
      path.startsWith("/api/v1/admin/producers") ||
      path.startsWith("/api/v1/admin/approvals") ||
      path.startsWith("/api/v1/admin/governance");
    if (isGovernanceRoute && hasGovernancePermissionGrant(reqPerms)) {
      return next();
    }

    const ok = await isAdminUser(userId);
    if (!ok) {
      if (isDevEnv()) {
        console.warn("[admin.middleware] forbidden", {
          path: req.originalUrl || req.url,
          method: req.method,
          userId: req.user?.id ?? null,
          role: req.user?.role ?? null,
          roles: req.user?.roles ?? null,
          permissionCount: reqPerms.size,
        });
      }
      return res.status(403).json({ success: false, message: "Forbidden", code: "ADMIN_NOT_WHITELISTED" });
    }

    // So that requirePermission("admin.approvals.manage") etc. pass on admin routes
    req.user.isWhitelistedAdmin = true;
    const existing = req.user.permissions || [];
    const merged = [...new Set([...existing, ...ADMIN_PANEL_PERMISSIONS])];
    req.user.permissions = merged;

    return next();
  } catch (e) {
    return res.status(500).json({ success: false, message: "Admin guard failed" });
  }
};

export {};
