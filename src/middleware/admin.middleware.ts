const prisma = require("../infrastructure/db/prismaClient");

function normalizePhoneDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

async function isAdminUser(userId) {
  // ✅ BPA Standard: DB whitelist (source of truth)
  const auth = await prisma.userAuth.findUnique({
    where: { userId: Number(userId) },
    select: { phone: true, email: true },
  });

  const phoneDigits = normalizePhoneDigits(auth?.phone);
  const phoneLast11 = phoneDigits.length > 11 ? phoneDigits.slice(-11) : phoneDigits;
  const emailNorm = String(auth?.email || "").trim().toLowerCase();

  if (!phoneDigits && !emailNorm) return false;

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

  // 🚑 Emergency fallback (optional): old env allowlists
  // Keep this for dev/ops rescue only. Remove later if you want strict DB-only.
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

module.exports = async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const ok = await isAdminUser(userId);
    if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });
    return next();
  } catch (e) {
    return res.status(500).json({ success: false, message: "Admin guard failed" });
  }
};

export {};
