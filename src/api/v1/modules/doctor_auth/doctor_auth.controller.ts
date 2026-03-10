/**
 * Doctor panel auth: POST /api/v1/doctor/auth/login
 * Verifies credentials, ensures user has doctor access (DoctorVerification or ClinicStaffProfile DOCTOR),
 * sets cookie, returns redirectPath so frontend can send user to dashboard or verification without post-auth-landing.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");
const { verifyCredentials } = require("../../services/authUnified.service");
const doctorService = require("../doctor/doctor.service");

async function hasDoctorAccess(userId: number): Promise<{ hasAccess: boolean; isVerified: boolean }> {
  const [doctorVerification, branchMemberIds] = await Promise.all([
    prisma.doctorVerification.findUnique({
      where: { userId },
      select: { verificationStatus: true },
    }),
    doctorService.getDoctorBranchMemberIds(userId),
  ]);
  const hasVerification = !!doctorVerification;
  const hasBranches = branchMemberIds.length > 0;
  const isVerified =
    String(doctorVerification?.verificationStatus ?? "").toUpperCase() === "VERIFIED";
  const hasAccess = hasVerification || hasBranches;
  return { hasAccess, isVerified };
}

exports.login = async (req: any, res: any) => {
  try {
    const { email, phone, password } = req.body;

    let authRow: any;
    let user: any;
    try {
      const result = await verifyCredentials({
        email: email || null,
        phone: phone || null,
        password: password || "",
      });
      authRow = result.authRow;
      user = result.user;
    } catch (credErr: any) {
      const code = credErr.statusCode || 400;
      return res.status(code).json({ success: false, message: credErr.message || "Invalid credentials" });
    }

    const { hasAccess, isVerified } = await hasDoctorAccess(user.id);
    // Allow login even without doctor access: new applicants go to verification to submit their info
    const redirectPath = !hasAccess
      ? "/doctor/verification"
      : isVerified
        ? "/doctor/dashboard"
        : "/doctor/verification";
    const token = jwt.sign({ id: user.id }, appConfig.jwt.secret, { expiresIn: "7d" });

    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.cookie("access_token", token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      redirectPath,
      user: {
        id: user.id,
        email: authRow?.email ?? user.auth?.email ?? null,
        phone: authRow?.phone ?? user.auth?.phone ?? null,
        displayName: user.profile?.displayName || null,
        username: user.profile?.username || null,
      },
    });
  } catch (e) {
    console.error("Doctor login error:", e);
    res.status(500).json({ success: false, message: "Login failed" });
  }
};

exports.logout = async (req: any, res: any) => {
  try {
    const isProd = String(process.env.NODE_ENV || "development") === "production";
    res.clearCookie("access_token", {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      domain: process.env.COOKIE_DOMAIN || "localhost",
    });
    res.status(200).json({ success: true, message: "Logged out" });
  } catch {
    res.status(500).json({ success: false, message: "Logout failed" });
  }
};
