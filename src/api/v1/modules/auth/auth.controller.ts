const prisma = require("../../../../infrastructure/db/prismaClient");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const appConfig = require("../../../../config/appConfig");
const { resolvePermissionsForUser } = require("../../utils/permissions");
const { getPermissionsForOwnerPanel } = require("../../services/scopePermission.service");
const crypto = require("crypto");
const {
  verifyCredentials,
  resolveAuthContexts,
  decideRedirect,
} = require("../../services/authUnified.service");
const { memberRoleToWarehouseStaffRole } = require("../../utils/warehouseStaffRoleMapping");
const {
  branchAccessPermissionUpsertDataForInviteAccept,
} = require("../../services/branchAccessPermissionInviteAccept");

/** BranchAccessPermission.role is MemberRole — omit when invite uses WarehouseStaffRole-only values. */
function memberRoleForBranchAccessPermission(role: string | null | undefined): string | undefined {
  if (!role) return undefined;
  const r = String(role).toUpperCase();
  const memberRoles = new Set([
    "OWNER",
    "ORG_ADMIN",
    "BRANCH_MANAGER",
    "BRANCH_STAFF",
    "SELLER",
    "DELIVERY_MANAGER",
    "DELIVERY_STAFF",
    "WAREHOUSE_MANAGER",
    "RECEIVING_STAFF",
    "DISPATCH_STAFF",
    "DOCTOR",
    "CLINIC_STAFF",
    "CLINIC_RECEPTION",
    "CLINIC_INVENTORY_STAFF",
    "PHARMACIST",
    "GROOMING_STAFF",
    "BOARDING_STAFF",
    "TRAINING_STAFF",
  ]);
  return memberRoles.has(r) ? r : undefined;
}

/** Cookie options for access_token: host-only in dev (no Domain), so browser accepts on localhost:port. */
function getAccessTokenCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const opts: {
    httpOnly: boolean;
    sameSite: string;
    secure: boolean;
    maxAge: number;
    path: string;
    domain?: string;
  } = {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/",
  };
  if (isProd && process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;
  return opts;
}

/** Options for clearCookie (must match set cookie so browser clears the right one). */
function getAccessTokenClearCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const opts: { httpOnly: boolean; sameSite: string; secure: boolean; path: string; domain?: string } = {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  };
  if (isProd && process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;
  return opts;
}

async function generateUniqueUsername({ emailNorm, phoneNorm, displayName }) {
  // base username
  let base =
    (emailNorm ? emailNorm.split("@")[0] : "") ||
    (phoneNorm ? `user${phoneNorm.replace(/\D/g, "")}` : "") ||
    (displayName ? displayName.toLowerCase().replace(/\s+/g, "") : "user");

  // sanitize
  base = base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);

  if (!base) base = "user";

  // try base, then base_1234...
  let username = base;
  for (let i = 0; i < 10; i++) {
    const exists = await prisma.userProfile.findFirst({
      where: { username },
      select: { id: true },
    });

    if (!exists) return username;

    const suffix = Math.floor(1000 + Math.random() * 9000);
    username = `${base}_${suffix}`.slice(0, 30);
  }

  // worst case fallback
  return `user_${Date.now()}`;
}

/**
 * Helper function to create notifications for pending staff invites
 * Called after successful login to notify users of pending invitations
 */
async function createNotificationsForPendingInvites(userId, emailNorm, phoneNorm) {
  try {
    // Find pending invites matching user's email or phone
    const pendingInvites = await prisma.staffInvite.findMany({
      where: {
        status: "PENDING",
        OR: [
          emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
          phoneNorm ? { phone: phoneNorm } : undefined,
        ].filter(Boolean),
        expiresAt: {
          gt: new Date(), // Not expired
        },
      },
      include: {
        branch: { select: { id: true, name: true } },
        org: { select: { id: true, name: true } },
      },
    });

    if (pendingInvites.length === 0) return;

    // Check for existing notifications to avoid duplicates
    const existingNotifications = await prisma.notification.findMany({
      where: {
        userId,
        type: "STAFF_INVITE",
        readAt: null, // Only check unread notifications
      },
      select: { meta: true },
    });

    const existingInviteIds = new Set(
      existingNotifications
        .map((n) => n.meta && typeof n.meta === "object" && "inviteId" in n.meta ? n.meta.inviteId : null)
        .filter(Boolean)
    );

    // Create notifications for invites that don't already have notifications
    const notificationsToCreate = pendingInvites
      .filter((invite) => !existingInviteIds.has(invite.id))
      .map((invite) => ({
        userId,
        type: "STAFF_INVITE",
        title: "Staff Invitation",
        message: `You have been invited to join ${invite.branch?.name || "a branch"} as ${invite.role}${invite.org?.name ? ` in ${invite.org.name}` : ""}.`,
        meta: {
          inviteId: invite.id,
          branchId: invite.branchId,
          branchName: invite.branch?.name || null,
          orgId: invite.orgId,
          orgName: invite.org?.name || null,
          role: invite.role,
          expiresAt: invite.expiresAt?.toISOString() || null,
        },
      }));

    if (notificationsToCreate.length > 0) {
      await prisma.notification.createMany({
        data: notificationsToCreate,
      });
    }
  } catch (error) {
    // Log error but don't fail login
    console.error("Error creating notifications for pending invites:", error);
  }
}

/**
 * REGISTER
 * Body: { name?, email?, phone?, password, address? }
 */
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, address, isOwner } = req.body;

    const emailNorm = (email || "").trim().toLowerCase();
    const phoneNormRaw = (phone || "").trim();
    // Normalize phone to digits-only for matching stored values consistently (e.g., "+880 17..." -> "88017...")
    const phoneNorm = phoneNormRaw ? phoneNormRaw.replace(/\D/g, "") : "";

    if (!emailNorm && !phoneNorm) {
      return res.status(400).json({ success: false, message: "email or phone is required" });
    }

    if (!password || password.length < 4) {
      return res.status(400).json({ success: false, message: "password is required (min 4 chars)" });
    }

    // ✅ check existing in UserAuth
    const existingAuth = await prisma.userAuth.findFirst({
      where: {
        OR: [
          emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
          phoneNorm ? { phone: phoneNorm } : undefined,
        ].filter(Boolean),
      },
      select: { id: true, userId: true },
    });

    if (existingAuth) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // ✅ required profile fields
    const displayName = (name && name.trim()) ? name.trim() : "New User";
    const username = await generateUniqueUsername({ emailNorm, phoneNorm, displayName });

    // ✅ create user with nested relations only (User has relations: auth/profile/wallet)
    const user = await prisma.user.create({
      data: {
        auth: {
          create: {
            email: emailNorm || null,
            phone: phoneNorm || null,

            // IMPORTANT: if your field is "password" not "passwordHash"
            passwordHash,
          },
        },
        profile: {
          create: {
            displayName, // REQUIRED
            username,    // REQUIRED
            // Address removed as it does not exist in UserProfile
          },
        },
        wallet: {
          create: {
            balance: 0.0,
            points: 0,
            tier: "Bronze",
            currency: "BDT",
          },
        },
      },
      include: { auth: true, profile: true, wallet: true },
    });

    // ✅ If registering as Owner, create OwnerProfile
    if (isOwner) {
      await prisma.ownerProfile.create({
        data: {
          userId: user.id,
          name: displayName,
        },
      });

      // If address provided, create initial OwnerKyc record
      if (address) {
        await prisma.ownerKyc.create({
          data: {
            userId: user.id,
            fullName: displayName,
            presentAddressJson: { address },
            verificationStatus: "UNSUBMITTED",
          },
        });
      }
    }

    const token = jwt.sign({ id: user.id }, appConfig.jwt.secret, { expiresIn: "7d" });

    return res.status(201).json({
      success: true,
      message: "User registered successfully!",
      token,
      user: {
        id: user.id,
        email: user.auth?.email || null,
        phone: user.auth?.phone || null,
        displayName: user.profile?.displayName || null,
        username: user.profile?.username || null,
      },
    });
  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({
      success: false,
      message: "Registration failed",
      error: error.message,
    });
  }
};

/**
 * LOGIN
 * Body: { email? or phone?, password }
 * Uses shared authUnified.service for credentials + canonical contexts/redirect.
 */
exports.login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    console.info("[AUTH_LOGIN_ACTIVE_MARKER_V3] start", {
      file: __filename,
      hasEmail: !!email,
      hasPhone: !!phone,
    });

    // Shared credential verification
    let authRow;
    try {
      const result = await verifyCredentials({
        email: email || null,
        phone: phone || null,
        password: password || "",
      });
      authRow = result.authRow;
    } catch (credErr) {
      const code = credErr.statusCode || 400;
      return res.status(code).json({ success: false, message: credErr.message || "Invalid credentials" });
    }

    const emailNorm = (email || "").trim().toLowerCase() || null;
    const phoneNorm = phone ? String(phone).replace(/\D/g, "") : null;

    // Create notifications for pending staff invites (non-blocking)
    createNotificationsForPendingInvites(authRow.user.id, emailNorm, phoneNorm).catch((err) => {
      console.error("Failed to create invite notifications:", err);
    });

    // Get user roles and memberships for role-based redirect
    const [orgMembers, branchMembers, countryRoles] = await Promise.all([
      prisma.orgMember.findMany({
        where: { userId: authRow.user.id, status: "ACTIVE" },
        include: {
          org: { select: { id: true, name: true } },
          roles: { include: { role: true } },
        },
      }),
      prisma.branchMember.findMany({
        where: { userId: authRow.user.id, status: "ACTIVE" },
        include: {
          branch: {
            select: {
              id: true,
              name: true,
              types: {
                select: {
                  type: {
                    select: {
                      code: true
                    }
                  }
                }
              }
            }
          },
          roles: { include: { role: true } },
        },
      }),
      prisma.userCountryRole.findMany({
        where: { userId: authRow.user.id },
        select: {
          country: { select: { id: true, code: true, name: true } },
          role: { select: { id: true, key: true, label: true, scope: true } },
        },
      }),
    ]);

    // Check branch access permissions for staff members
    // For each branch membership, check/create access permission
    const { requestBranchAccess } = require("../../services/branchAccessPermission.service");
    const { notifyManagerOfAccessRequest } = require("../../services/branchAccessNotification.service");

    const branchAccessInfo = [];
    for (const branchMember of branchMembers) {
      try {
        // Check if permission exists
        let permission = await prisma.branchAccessPermission.findUnique({
          where: {
            branchId_userId: {
              branchId: branchMember.branchId,
              userId: authRow.user.id,
            },
          },
        });

        // If no permission exists, create a pending request
        if (!permission) {
          permission = await requestBranchAccess(
            authRow.user.id,
            branchMember.branchId,
            branchMember.role
          );
          // Notify manager (non-blocking)
          notifyManagerOfAccessRequest(branchMember.branchId, authRow.user.id)
            .catch((err) => {
              console.error("Failed to notify manager of access request:", err);
            });
        } else if (permission.status === "APPROVED") {
          // Check if expired
          if (permission.expiresAt && new Date(permission.expiresAt) < new Date()) {
            // Auto-expire
            await prisma.branchAccessPermission.update({
              where: { id: permission.id },
              data: {
                status: "EXPIRED",
                updatedAt: new Date(),
              },
            });
            permission.status = "EXPIRED";
          }
        }

        branchAccessInfo.push({
          branchId: branchMember.branchId,
          permissionStatus: permission.status,
          expiresAt: permission.expiresAt,
        });
      } catch (error) {
        console.error(`Error checking access for branch ${branchMember.branchId}:`, error);
        // Continue with other branches
      }
    }

    // Canonical redirect (backend is source of truth)
    const contexts = await resolveAuthContexts(authRow.user.id);
    const default_redirect = await decideRedirect(authRow.user.id, contexts, {});
    // Legacy primaryRole for backward compatibility
    const primaryRole =
      orgMembers.length > 0
        ? orgMembers[0].role || "ORG_OWNER"
        : branchMembers.length > 0
        ? branchMembers[0].role || "STAFF"
        : countryRoles.length > 0
        ? countryRoles[0]?.role?.key || "COUNTRY_ADMIN"
        : "CUSTOMER";

    const payload = { id: authRow.user.id };
    console.info("[AUTH_LOGIN_ACTIVE_MARKER_V3] payload", {
      file: __filename,
      payloadKeys: Object.keys(payload),
      hasPerms: Object.prototype.hasOwnProperty.call(payload, "perms"),
    });
    const token = jwt.sign(payload, appConfig.jwt.secret, { expiresIn: "7d" });

    const tokenBytes = Buffer.byteLength(token, "utf8");
    console.info("[AUTH_LOGIN_ACTIVE_MARKER_V3] token", { file: __filename, tokenBytes, cookieLimitNote: "browsers ~4096" });

    // ✅ Also set HttpOnly cookie (keeps old Bearer flow intact). No Domain in dev = host-only.
    res.cookie("access_token", token, getAccessTokenCookieOptions());

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: authRow.user.id,
        email: authRow.email || null,
        phone: authRow.phone || null,
        displayName: authRow.user.profile?.displayName || null,
        username: authRow.user.profile?.username || null,
        role: primaryRole,
        redirectPath: default_redirect,
        organizations: orgMembers.map((om) => ({
          id: om.org.id,
          name: om.org.name,
          role: om.role,
        })),
        branches: branchMembers.map((bm) => {
          const accessInfo = branchAccessInfo.find((ai) => ai.branchId === bm.branch.id);
          return {
            id: bm.branch.id,
            name: bm.branch.name,
            type: bm.branch.types?.[0]?.type?.code || null,
            role: bm.role,
            accessStatus: accessInfo?.permissionStatus || "PENDING",
            accessExpiresAt: accessInfo?.expiresAt || null,
          };
        }),
        countryRoles: countryRoles.map((cr) => ({
          country: cr.country,
          role: cr.role,
        })),
      },
      contexts,
      default_redirect,
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ success: false, message: "Login failed", error: error.message });
  }
};

/**
 * GET /api/v1/auth/me
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        auth: true,
        profile: {
          include: {
            avatarMedia: true,
            coverMedia: true,
          },
        },
        wallet: true,
        pets: true,
      },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (user?.profile) {
      try {
        const {
          attachEffectivePhotoToProfile,
        } = require("../../services/providerProfileBootstrap.service");
        user.profile = attachEffectivePhotoToProfile(user.profile);
      } catch (e) {
        console.warn(
          "attachEffectivePhotoToProfile skipped:",
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    // Phase-1 admin access (no schema change):
    // - ADMIN_USER_IDS: comma-separated user IDs
    // - ADMIN_PHONES: comma-separated phones (supports +880 / spaces; compared by digits)
    // - ADMIN_EMAILS: comma-separated emails (lowercased)
    const allowIds = String(process.env.ADMIN_USER_IDS || "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter(Boolean);

    const allowPhones = String(process.env.ADMIN_PHONES || "")
      .split(",")
      .map((x) => String(x).trim())
      .filter(Boolean)
      .map((x) => x.replace(/\D/g, ""));

    const allowEmails = String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((x) => String(x).trim().toLowerCase())
      .filter(Boolean);

    const userPhoneRaw = (
      user?.auth?.phone ||
      user?.auth?.mobile ||
      user?.phone ||
      user?.profile?.phone ||
      ""
    );
    let userPhoneDigits = String(userPhoneRaw).replace(/\D/g, "");
    // BD normalize: if starts with 880, compare also last 11 digits
    const userPhoneLast11 = userPhoneDigits.length > 11 ? userPhoneDigits.slice(-11) : userPhoneDigits;

    const userEmail = String(user?.auth?.email || user?.email || "").toLowerCase();

    const isAdmin =
      allowIds.includes(user.id) ||
      (userPhoneDigits && allowPhones.includes(userPhoneDigits)) ||
      (userPhoneLast11 && allowPhones.includes(userPhoneLast11)) ||
      (userEmail && allowEmails.includes(userEmail));

    const role = isAdmin ? "ADMIN" : "USER";

    let permissions =
      role === "ADMIN"
        ? [
            "dashboard.read",
            "branch.read",
            "branch.write",
            "staff.read",
            "staff.write",
            "wallet.read",
            "wallet.withdraw_request.read",
            "wallet.withdraw.approve",
            "fundraising.read",
            "fundraising.verify",
            "users.read",
            "settings.write",
          ]
        : [];

    // OWNER CONTEXT (used by Owner Panel).
    // This is additive only — it won't break Flutter/public consumers.
    const ownerProfile = await prisma.ownerProfile.findUnique({
      where: { userId: user.id },
      select: { id: true, name: true, nid: true, createdAt: true },
    });

    const ownedOrgs = await prisma.organization.findMany({
      where: { ownerUserId: user.id },
      select: { id: true, name: true, status: true },
      orderBy: { id: "desc" },
    });

    // Owner panel: scope-filtered permissions for delegates; full perms for actual owners.
    const hasDelegations =
      (await prisma.ownerDelegation.count({ where: { delegatedUserId: userId } })) > 0;
    const hasTeamMember =
      (await prisma.ownerTeamMember.count({ where: { userId } })) > 0;
    if (role !== "ADMIN") {
      if (ownerProfile || ownedOrgs.length > 0) {
        permissions = await resolvePermissionsForUser(userId);
      } else if (hasDelegations || hasTeamMember) {
        const base = await resolvePermissionsForUser(userId);
        const panelPerms = await getPermissionsForOwnerPanel(userId);
        permissions = [...new Set([...base, ...panelPerms])];
      } else {
        permissions = await resolvePermissionsForUser(userId);
      }
    }

    const ownerKyc = await prisma.ownerKyc.findUnique({
      where: { userId: user.id },
      select: { verificationStatus: true, submittedAt: true, reviewedAt: true },
    });

    const countryRoles = await prisma.userCountryRole.findMany({
      where: { userId: user.id },
      select: {
        country: { select: { id: true, code: true, name: true } },
        role: { select: { id: true, key: true, label: true, scope: true } },
        createdAt: true,
      },
    });

    const branchMemberCount = await prisma.branchMember.count({
      where: { userId: user.id, status: "ACTIVE" },
    });
    const hasStaffAccess =
      Boolean(ownerProfile || ownedOrgs.length > 0) || branchMemberCount > 0;

    const doctorProfileCount = await prisma.clinicStaffProfile.count({
      where: {
        branchMember: { userId: user.id },
        staffType: "DOCTOR",
      },
    });
    const doctorVerification =
      typeof prisma.doctorVerification?.findUnique === "function"
        ? await prisma.doctorVerification.findUnique({
            where: { userId: user.id },
            select: { verificationStatus: true },
          })
        : null;
    const hasDoctorAccess =
      doctorVerification?.verificationStatus === "VERIFIED" ||
      (doctorProfileCount > 0 && (!doctorVerification || doctorVerification.verificationStatus === "VERIFIED"));

    const kycApproved =
      ownerKyc && ["VERIFIED", "APPROVED"].includes(String(ownerKyc.verificationStatus || "").toUpperCase());

    const panels = {
      admin: isAdmin,
      owner: Boolean(ownerProfile || ownedOrgs.length > 0 || kycApproved || hasDelegations || hasTeamMember),
      partner: Boolean(user?.partnerStatus && user.partnerStatus !== "NOT_APPLIED"),
      country: countryRoles.length > 0,
      staff: hasStaffAccess,
      doctor: hasDoctorAccess,
    };

    const userContextService = require("../../services/userContext.service");
    const contexts = await userContextService.listContexts(userId);
    const defaultContext = await userContextService.getDefaultContext(userId);
    const contextCount = contexts.length;
    const hasOrg = ownedOrgs.length > 0;
    const hasBranch = branchMemberCount > 0;
    const needsOnboarding =
      panels.owner &&
      !hasOrg &&
      !hasBranch &&
      contextCount === 0 &&
      !ownerProfile;

    const authContexts = await resolveAuthContexts(userId);
    let default_redirect = await decideRedirect(userId, authContexts);
    if (panels.doctor === true) default_redirect = "/doctor/dashboard";
    else if (doctorProfileCount > 0 && String(doctorVerification?.verificationStatus ?? "").toUpperCase() !== "VERIFIED") default_redirect = "/doctor/verification";
    const needsActivitySelection = default_redirect === "/choose-activity";

    // Routing decision payload for post-auth-landing
    const hasBusinessContext = hasOrg || hasBranch || contextCount > 0;
    const allowedPanels = Object.entries(panels)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    const isCustomerOnly = allowedPanels.length === 0;

    const lastLoginAt = user?.auth?.lastLoginAt ?? null;
    const isFirstLogin = lastLoginAt == null;
    const noContextsOrOrg = contextCount === 0 && !hasOrg && !hasBranch;
    const unclassified = allowedPanels.length === 0;
    const onboardingIntroRequired = noContextsOrOrg && unclassified;
    const onboardingReason = onboardingIntroRequired
      ? (isFirstLogin ? "intro_first_login_no_context_no_panels" : "intro_unclassified_no_context_no_panels")
      : null;

    if (onboardingIntroRequired) {
      default_redirect = "/getting-started";
    }

    const recommendedNextPaths = {
      owner: "/owner/onboarding",
      producer: "/producer/kyc",
      clinic: "/clinic",
      doctor: "/doctor/dashboard",
      shop: "/shop",
      customer: "/mother",
    };

    const ownerKycStatus = ownerKyc?.verificationStatus
      ? String(ownerKyc.verificationStatus).toUpperCase()
      : "NONE";
    const producerCtx = authContexts.find((c) => c.role === "PRODUCER");
    const producerPending = producerCtx?.status === "PENDING";
    const ownerNeedsKyc =
      panels.owner &&
      (ownerKycStatus === "UNSUBMITTED" || ownerKycStatus === "REJECTED" || ownerKycStatus === "SUBMITTED");
    const ownerIsDoctorCandidate =
      doctorProfileCount > 0 &&
      String(doctorVerification?.verificationStatus ?? "").toUpperCase() !== "VERIFIED";
    const verificationRequired = ownerNeedsKyc || producerPending;
    const verificationStatus =
      producerPending
        ? "PENDING"
        : ownerKycStatus === "VERIFIED" || ownerKycStatus === "APPROVED"
          ? "APPROVED"
          : ownerKycStatus === "SUBMITTED"
            ? "PENDING"
            : ownerKycStatus === "REJECTED"
              ? "REJECTED"
              : "NONE";
    const verificationRedirect = producerPending
      ? "/producer/kyc"
      : ownerNeedsKyc
        ? ownerIsDoctorCandidate
          ? "/doctor/verification"
          : "/owner/kyc"
        : null;

    const debugReasons = [];
    if (onboardingIntroRequired) debugReasons.push("onboardingIntroRequired");
    if (verificationRequired) debugReasons.push(`verification: ${verificationStatus} -> ${verificationRedirect}`);
    if (needsActivitySelection) debugReasons.push("needsActivitySelection");
    if (isCustomerOnly) debugReasons.push("isCustomerOnly");
    debugReasons.push(`default_redirect: ${default_redirect}`);

    const routing = {
      needsActivitySelection: onboardingIntroRequired ? false : needsActivitySelection,
      default_redirect,
      allowedPanels,
      isCustomerOnly,
      hasBusinessContext,
      verificationRequired,
      verificationStatus,
      verificationRedirect: verificationRedirect || null,
      onboardingIntroRequired,
      ...(onboardingReason && { onboardingReason }),
      recommendedNextPaths,
      ...(process.env.NODE_ENV !== "production" && { debugReason: debugReasons.join("; ") }),
    };

    const doctorVerificationStatus =
      doctorVerification != null
        ? (doctorVerification.verificationStatus ?? "UNSUBMITTED")
        : null;

    return res.status(200).json({
      success: true,
      data: user,
      role,
      permissions,
      panels,
      doctorVerificationStatus,
      countryRoles,
      contexts,
      defaultContext: defaultContext
        ? (() => {
            const isOwnerContext = defaultContext.ownerUserId == null;
            const isTeamContext = defaultContext.ownerUserId != null && defaultContext.teamId != null;
            const type = isTeamContext ? "TEAM" : isOwnerContext ? "OWNER" : "BRANCH";
            const recommendedPath =
              type === "TEAM"
                ? "/owner/workspace"
                : type === "OWNER"
                  ? (() => {
                      const kyc = ownerKyc?.verificationStatus
                        ? String(ownerKyc.verificationStatus).toUpperCase()
                        : "";
                      if (kyc !== "UNSUBMITTED" && kyc !== "REJECTED") return "/owner/dashboard";
                      return ownerIsDoctorCandidate ? "/doctor/verification" : "/owner/kyc";
                    })()
                  : "/owner/dashboard";
            return {
              id: defaultContext.id,
              ownerUserId: defaultContext.ownerUserId,
              branchId: defaultContext.branchId,
              teamId: defaultContext.teamId,
              roles: defaultContext.roles,
              scopes: defaultContext.scopes,
              defaultDashboard: defaultContext.defaultDashboard,
              isDefault: defaultContext.isDefault,
              type,
              recommendedPath,
              owner: defaultContext.owner ? { id: defaultContext.owner.id, displayName: defaultContext.owner.profile?.displayName } : null,
              branch: defaultContext.branch ? { id: defaultContext.branch.id, name: defaultContext.branch.name } : null,
              team: defaultContext.team ? { id: defaultContext.team.id, name: defaultContext.team.name } : null,
            };
          })()
        : null,
      onboarding: {
        needsOnboarding,
        hasOrg,
        hasBranch,
        contextCount,
      },
      default_redirect,
      needsActivitySelection,
      routing,
      owner: ownerProfile
        ? {
            ownerProfileId: ownerProfile.id,
            name: ownerProfile.name,
            nid: ownerProfile.nid,
            orgs: ownedOrgs,
            kyc: ownerKyc || { verificationStatus: "UNSUBMITTED" },
          }
        : { ownerProfileId: null, name: null, nid: null, orgs: ownedOrgs, kyc: ownerKyc || { verificationStatus: "UNSUBMITTED" } },
    });
  } catch (error) {
    console.error("getProfile Error:", error);
    const message = process.env.NODE_ENV !== "production" ? (error as Error)?.message : "Server Error";
    const details = process.env.NODE_ENV !== "production" && (error as Error)?.stack ? { stack: (error as Error).stack } : undefined;
    return res.status(500).json({
      success: false,
      message,
      ...(details && { details }),
    });
  }
};

/**
 * POST /api/v1/auth/logout
 * Dev/Browser friendly logout:
 * - Clears HttpOnly cookie used by Admin Web (Chrome/Firefox compatible)
 * - Does NOT break existing Bearer token clients (Flutter) because they can ignore cookies
 */
exports.logout = async (req, res) => {
  try {
    // IMPORTANT: attributes must match the login cookie attributes (no Domain in dev).
    res.clearCookie("access_token", getAccessTokenClearCookieOptions());

    return res.status(200).json({ success: true, message: "Logged out" });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Logout failed" });
  }
};

/**
 * GET /api/v1/auth/invites/verify?token=...
 * Public endpoint used by the Register page to validate an invite link.
 */
exports.verifyInvite = async (req, res) => {
  try {
    const token = String(req.query?.token || "").trim();
    if (!token) {
      return res.status(400).json({ success: false, message: "token is required" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // 1) Branch staff invite
    const staffInvite = await prisma.staffInvite.findUnique({
      where: { tokenHash },
      include: {
        branch: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        org: { select: { id: true, name: true } },
      },
    });

    if (staffInvite) {
      if (staffInvite.expiresAt && new Date(staffInvite.expiresAt).getTime() < Date.now()) {
        if (staffInvite.status === "PENDING") {
          await prisma.staffInvite.update({ where: { id: staffInvite.id }, data: { status: "EXPIRED" } });
        }
        return res.status(400).json({ success: false, message: "Invite expired" });
      }
      if (staffInvite.status !== "PENDING") {
        return res
          .status(400)
          .json({ success: false, message: `Invite is not pending (${staffInvite.status})` });
      }

      const emailNorm = (staffInvite.email || "").trim().toLowerCase() || null;
      const phoneNorm = (staffInvite.phone || "").trim().replace(/\D/g, "") || null;
      let userExists = false;

      if (emailNorm || phoneNorm) {
        const existingAuth = await prisma.userAuth.findFirst({
          where: {
            OR: [
              emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
              phoneNorm ? { phone: phoneNorm } : undefined,
            ].filter(Boolean),
          },
          select: { userId: true },
        });
        if (existingAuth) userExists = true;
      }

      return res.json({
        success: true,
        data: {
          inviteType: staffInvite.targetType === "WAREHOUSE" ? "WAREHOUSE_STAFF" : "BRANCH_STAFF",
          targetType: staffInvite.targetType || "BRANCH",
          orgId: staffInvite.orgId,
          branchId: staffInvite.branchId,
          warehouseId: staffInvite.warehouseId || null,
          role: staffInvite.role || null,
          warehouseRole: staffInvite.warehouseRole || null,
          email: staffInvite.email || null,
          phone: staffInvite.phone || null,
          displayName: staffInvite.displayName || null,
          expiresAt: staffInvite.expiresAt,
          org: staffInvite.org || null,
          branch: staffInvite.branch || null,
          warehouse: staffInvite.warehouse || null,
          userExists,
          requiresRegistration: !userExists,
        },
      });
    }

    // 2) Team invitation (owner team, email-based)
    const { verifyTeamInvitation } = require("../../services/teamInvitation.service");
    const teamVerified = await verifyTeamInvitation(token);
    if (teamVerified) {
      if (!teamVerified.valid) {
        return res.status(400).json({
          success: false,
          message: teamVerified.reason === "EXPIRED" ? "Invite expired" : `Invite is not pending (${teamVerified.reason})`,
        });
      }
      const inv = teamVerified.invite;
      return res.json({
        success: true,
        data: {
          inviteType: "TEAM",
          teamId: inv.teamId,
          ownerUserId: inv.ownerUserId,
          email: inv.email,
          scopes: inv.scopes || [],
          branchIds: inv.branchIds || [],
          team: inv.team || null,
          owner: inv.owner || null,
          expiresAt: inv.expiresAt,
          userExists: teamVerified.userExists,
          requiresRegistration: teamVerified.requiresRegistration,
        },
      });
    }

    // 3) Country/State access invite
    const accessInvite = await prisma.accessInvite.findUnique({
      where: { tokenHash },
      include: {
        role: { select: { id: true, key: true, label: true, scope: true } },
        country: { select: { id: true, code: true, name: true } },
        state: { select: { id: true, code: true, name: true } },
      },
    });

    if (!accessInvite) return res.status(404).json({ success: false, message: "Invalid invite token" });

    if (accessInvite.expiresAt && new Date(accessInvite.expiresAt).getTime() < Date.now()) {
      if (accessInvite.status === "PENDING") {
        await prisma.accessInvite.update({ where: { id: accessInvite.id }, data: { status: "EXPIRED" } });
      }
      return res.status(400).json({ success: false, message: "Invite expired" });
    }

    if (accessInvite.status !== "PENDING") {
      return res
        .status(400)
        .json({ success: false, message: `Invite is not pending (${accessInvite.status})` });
    }

    const emailNorm = (accessInvite.email || "").trim().toLowerCase();
    const existingAuth = await prisma.userAuth.findFirst({
      where: { email: { equals: emailNorm, mode: "insensitive" } },
      select: { userId: true },
    });
    const userExists = Boolean(existingAuth);

    return res.json({
      success: true,
      data: {
        inviteType: accessInvite.scopeType === "STATE" ? "STATE_STAFF" : "COUNTRY_STAFF",
        scopeType: accessInvite.scopeType,
        role: accessInvite.role,
        email: accessInvite.email,
        displayName: accessInvite.displayName || null,
        expiresAt: accessInvite.expiresAt,
        country: accessInvite.country || null,
        state: accessInvite.state || null,
        userExists,
        requiresRegistration: !userExists,
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/v1/auth/invites/accept
 * Body: { token, password?, displayName? }
 *
 * ✅ Creates/updates the user, assigns role, consumes invite
 * ✅ Auto-login: returns JWT token and sets HttpOnly cookie access_token
 * ✅ Existing users must be authenticated (session) to accept
 */
exports.acceptInvite = async (req, res) => {
  try {
    const { token, password, displayName } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: "token is required" });
    }

    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");

    // 1) Staff invite
    const staffInvite = await prisma.staffInvite.findUnique({
      where: { tokenHash },
      include: {
        branch: { select: { id: true, orgId: true } },
        warehouse: { select: { id: true, orgId: true, isActive: true } },
        org: { select: { id: true, name: true } },
      },
    });

    if (staffInvite) {
      if (staffInvite.status !== "PENDING") {
        return res.status(400).json({ success: false, message: `Invite is not pending (${staffInvite.status})` });
      }
      if (staffInvite.expiresAt && new Date(staffInvite.expiresAt).getTime() < Date.now()) {
        await prisma.staffInvite.update({ where: { id: staffInvite.id }, data: { status: "EXPIRED" } });
        return res.status(400).json({ success: false, message: "Invite expired" });
      }

      const emailNorm = (staffInvite.email || "").trim().toLowerCase() || null;
      const phoneNorm = (staffInvite.phone || "").trim().replace(/\D/g, "") || null;
      const existingAuth = await prisma.userAuth.findFirst({
        where: {
          OR: [
            emailNorm ? { email: { equals: emailNorm, mode: "insensitive" } } : undefined,
            phoneNorm ? { phone: phoneNorm } : undefined,
          ].filter(Boolean),
        },
        select: { userId: true },
      });

      const userId = await prisma.$transaction(async (tx) => {
        let uid = existingAuth?.userId || null;

        if (uid) {
          if (!req.user?.id || Number(req.user.id) !== Number(uid)) {
            throw Object.assign(new Error("Please log in to accept this invitation"), { statusCode: 401 });
          }
        } else {
          if (!password || String(password).length < 4) {
            throw Object.assign(new Error("password is required (min 4 chars)"), { statusCode: 400 });
          }
          const name = String(displayName || staffInvite.displayName || "BPA Staff").trim() || "BPA Staff";
          const username = await generateUniqueUsername({ emailNorm: emailNorm || "", phoneNorm: phoneNorm || "", displayName: name });
          const passwordHash = await bcrypt.hash(String(password), 10);
          const created = await tx.user.create({
            data: {
              status: "ACTIVE",
              auth: {
                create: {
                  provider: "LOCAL",
                  email: emailNorm,
                  phone: phoneNorm,
                  passwordHash,
                },
              },
              profile: {
                create: {
                  displayName: name,
                  username,
                },
              },
            },
            select: { id: true },
          });
          uid = created.id;
        }

        let member: { id: number } | null = null;
        if ((staffInvite.targetType || "BRANCH") === "WAREHOUSE") {
          if (!staffInvite.warehouseId || !staffInvite.warehouseRole) {
            throw Object.assign(new Error("Invalid warehouse invitation"), { statusCode: 400 });
          }
          const wh = await tx.warehouse.findUnique({
            where: { id: staffInvite.warehouseId },
            select: { id: true, orgId: true, isActive: true, branchId: true },
          });
          if (!wh || !wh.isActive) {
            throw Object.assign(new Error("Warehouse not available"), { statusCode: 400 });
          }
          if (Number(wh.orgId) !== Number(staffInvite.orgId)) {
            throw Object.assign(new Error("Invitation organization mismatch"), { statusCode: 400 });
          }

          // CRITICAL FIX: Create BranchMember for warehouse staff (unified staff model)
          member = await tx.branchMember.upsert({
            where: { branchId_userId: { branchId: wh.branchId, userId: uid } },
            update: { role: staffInvite.warehouseRole, status: "ACTIVE" },
            create: {
              orgId: staffInvite.orgId,
              branchId: wh.branchId,
              userId: uid,
              role: staffInvite.warehouseRole,
              status: "ACTIVE",
              invitedByUserId: staffInvite.invitedByUserId,
            },
          });

          // CRITICAL FIX: Create BranchAccessPermission for warehouse staff
          const bapRoleWh = memberRoleForBranchAccessPermission(staffInvite.warehouseRole);
          const bapWhPayload = branchAccessPermissionUpsertDataForInviteAccept({
            branchId: wh.branchId,
            userId: uid,
            invitedByUserId: staffInvite.invitedByUserId,
            memberRole: bapRoleWh ?? undefined,
          });
          await tx.branchAccessPermission.upsert({
            where: { branchId_userId: { branchId: wh.branchId, userId: uid } },
            create: bapWhPayload.create,
            update: bapWhPayload.update,
          });

          // Create WarehouseStaffAssignment
          const existingAssignment = await tx.warehouseStaffAssignment.findFirst({
            where: {
              warehouseId: staffInvite.warehouseId,
              userId: uid,
              role: staffInvite.warehouseRole,
            },
            select: { id: true, isActive: true },
          });
          if (existingAssignment) {
            await tx.warehouseStaffAssignment.update({
              where: { id: existingAssignment.id },
              data: { isActive: true, removedAt: null },
            });
          } else {
            await tx.warehouseStaffAssignment.create({
              data: {
                warehouseId: staffInvite.warehouseId,
                userId: uid,
                role: staffInvite.warehouseRole,
                isActive: true,
              },
            });
          }
        } else {
          if (!staffInvite.branchId || !staffInvite.role) {
            throw Object.assign(new Error("Invalid branch invitation"), { statusCode: 400 });
          }
          member = await tx.branchMember.upsert({
            where: { branchId_userId: { branchId: staffInvite.branchId, userId: uid } },
            update: { role: staffInvite.role, status: "ACTIVE" },
            create: {
              orgId: staffInvite.orgId,
              branchId: staffInvite.branchId,
              userId: uid,
              role: staffInvite.role,
              status: "ACTIVE",
              invitedByUserId: staffInvite.invitedByUserId,
            },
            select: { id: true },
          });

          const bapBranchPayload = branchAccessPermissionUpsertDataForInviteAccept({
            branchId: staffInvite.branchId,
            userId: uid,
            invitedByUserId: staffInvite.invitedByUserId,
            memberRole: staffInvite.role,
          });
          await tx.branchAccessPermission.upsert({
            where: { branchId_userId: { branchId: staffInvite.branchId, userId: uid } },
            create: bapBranchPayload.create,
            update: bapBranchPayload.update,
          });

          const whRole = memberRoleToWarehouseStaffRole(staffInvite.role);
          if (whRole) {
            const linkedWarehouse = await tx.warehouse.findFirst({
              where: { branchId: staffInvite.branchId, isActive: true },
              select: { id: true },
            });
            if (linkedWarehouse) {
              const existingAssignment = await tx.warehouseStaffAssignment.findFirst({
                where: {
                  warehouseId: linkedWarehouse.id,
                  userId: uid,
                  role: whRole,
                },
                select: { id: true, isActive: true },
              });
              if (existingAssignment) {
                await tx.warehouseStaffAssignment.update({
                  where: { id: existingAssignment.id },
                  data: { isActive: true, removedAt: null },
                });
              } else {
                await tx.warehouseStaffAssignment.create({
                  data: {
                    warehouseId: linkedWarehouse.id,
                    userId: uid,
                    role: whRole,
                    isActive: true,
                  },
                });
              }
            }
          }
        }

        if ((staffInvite.targetType || "BRANCH") === "BRANCH" && staffInvite.inviteAsDoctor && member) {
          const branchWithTypes = await tx.branch.findUnique({
            where: { id: staffInvite.branchId },
            select: { types: { select: { type: { select: { code: true } } } } },
          });
          const isClinic = branchWithTypes?.types?.some(
            (t) => String(t?.type?.code || "").toUpperCase() === "CLINIC"
          );
          if (isClinic) {
            await tx.clinicStaffProfile.upsert({
              where: { branchMemberId: member.id },
              create: {
                orgId: staffInvite.orgId,
                branchId: staffInvite.branchId,
                branchMemberId: member.id,
                staffType: "DOCTOR",
                status: "ACTIVE",
                onboardingStatus: "PENDING",
              },
              update: { staffType: "DOCTOR", status: "ACTIVE", onboardingStatus: "PENDING" },
            });
          }
        }

        await tx.staffInvite.update({
          where: { id: staffInvite.id },
          data: { status: "ACCEPTED", acceptedByUserId: uid },
        });

        return uid;
      });

      const tokenJwt = jwt.sign({ id: userId }, appConfig.jwt.secret, { expiresIn: "7d" });
      res.cookie("access_token", tokenJwt, getAccessTokenCookieOptions());

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { auth: true, profile: true },
      });

      const staffContexts = await resolveAuthContexts(userId);
      let staffRedirect = await decideRedirect(userId, staffContexts, { forceStaffPanel: true });

      let onboardingRequired = false;
      let onboardingPath = null;
      if ((staffInvite.targetType || "BRANCH") === "BRANCH" && staffInvite.inviteAsDoctor) {
        const profile = await prisma.clinicStaffProfile.findFirst({
          where: { branchMember: { userId, branchId: staffInvite.branchId }, staffType: "DOCTOR" },
          select: { onboardingStatus: true },
        });
        if (profile?.onboardingStatus === "PENDING") {
          onboardingRequired = true;
          onboardingPath = `/doctor/onboarding/${staffInvite.branchId}`;
          staffRedirect = onboardingPath;
        }
      }

      return res.json({
        success: true,
        message: "Invite accepted",
        token: tokenJwt,
        user: {
          id: userId,
          email: user?.auth?.email || null,
          phone: user?.auth?.phone || null,
          displayName: user?.profile?.displayName || null,
          username: user?.profile?.username || null,
        },
        data: {
          targetType: staffInvite.targetType || "BRANCH",
          branchId: staffInvite.branchId || null,
          warehouseId: staffInvite.warehouseId || null,
          role: staffInvite.role || null,
          warehouseRole: staffInvite.warehouseRole || null,
        },
        default_redirect: staffRedirect,
        onboardingRequired: onboardingRequired || undefined,
        onboardingPath: onboardingPath || undefined,
      });
    }

    // 2) Team invitation
    const teamInvitationService = require("../../services/teamInvitation.service");
    const teamVerified = await teamInvitationService.verifyTeamInvitation(token);
    if (teamVerified && teamVerified.valid) {
      const existingUserId = req.user?.id ? Number(req.user.id) : null;
      const { userId } = await teamInvitationService.acceptTeamInvitation(token, existingUserId, { password, displayName });
      const tokenJwt = jwt.sign({ id: userId }, appConfig.jwt.secret, { expiresIn: "7d" });
      res.cookie("access_token", tokenJwt, getAccessTokenCookieOptions());
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { auth: true, profile: true },
      });
      const userContextService = require("../../services/userContext.service");
      const defaultCtx = await userContextService.getDefaultContext(userId);
      const ctxType = defaultCtx?.ownerUserId != null && defaultCtx?.teamId != null ? "TEAM" : "OWNER";
      const recommendedPath = ctxType === "TEAM" ? "/owner/workspace" : "/owner/dashboard";

      return res.json({
        success: true,
        message: "Team invite accepted",
        token: tokenJwt,
        user: {
          id: userId,
          email: user?.auth?.email || null,
          displayName: user?.profile?.displayName || null,
          username: user?.profile?.username || null,
        },
        data: { inviteType: "TEAM", teamId: teamVerified.invite.teamId },
        defaultContext: { type: ctxType, recommendedPath },
        default_redirect: recommendedPath,
      });
    }
    if (teamVerified && !teamVerified.valid) {
      return res.status(400).json({
        success: false,
        message: teamVerified.reason === "EXPIRED" ? "Invite expired" : "Invalid or already used invite",
      });
    }

    // 3) Access invite (country/state)
    const accessInvite = await prisma.accessInvite.findUnique({
      where: { tokenHash },
      include: { role: { select: { id: true, key: true, label: true, scope: true } } },
    });

    if (!accessInvite) return res.status(404).json({ success: false, message: "Invalid invite token" });
    if (accessInvite.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `Invite is not pending (${accessInvite.status})` });
    }
    if (accessInvite.expiresAt && new Date(accessInvite.expiresAt).getTime() < Date.now()) {
      await prisma.accessInvite.update({ where: { id: accessInvite.id }, data: { status: "EXPIRED" } });
      return res.status(400).json({ success: false, message: "Invite expired" });
    }

    const emailNorm = (accessInvite.email || "").trim().toLowerCase();
    const existingAuth = await prisma.userAuth.findFirst({
      where: { email: { equals: emailNorm, mode: "insensitive" } },
      select: { userId: true },
    });

    const userId = await prisma.$transaction(async (tx) => {
      let uid = existingAuth?.userId || null;

      if (uid) {
        if (!req.user?.id || Number(req.user.id) !== Number(uid)) {
          throw Object.assign(new Error("Please log in to accept this invitation"), { statusCode: 401 });
        }
      } else {
        if (!password || String(password).length < 4) {
          throw Object.assign(new Error("password is required (min 4 chars)"), { statusCode: 400 });
        }
        const name = String(displayName || accessInvite.displayName || "BPA Staff").trim() || "BPA Staff";
        const username = await generateUniqueUsername({ emailNorm, phoneNorm: "", displayName: name });
        const passwordHash = await bcrypt.hash(String(password), 10);
        const created = await tx.user.create({
          data: {
            status: "ACTIVE",
            auth: {
              create: {
                provider: "LOCAL",
                email: emailNorm,
                phone: null,
                passwordHash,
              },
            },
            profile: {
              create: {
                displayName: name,
                username,
              },
            },
          },
          select: { id: true },
        });
        uid = created.id;
      }

      if (accessInvite.scopeType === "COUNTRY") {
        await tx.userCountryRole.upsert({
          where: { userId_countryId_roleId: { userId: uid, countryId: accessInvite.countryId, roleId: accessInvite.roleId } },
          update: {},
          create: { userId: uid, countryId: accessInvite.countryId, roleId: accessInvite.roleId },
        });
      }
      if (accessInvite.scopeType === "STATE") {
        await tx.userStateRole.upsert({
          where: { userId_stateId_roleId: { userId: uid, stateId: accessInvite.stateId, roleId: accessInvite.roleId } },
          update: {},
          create: { userId: uid, stateId: accessInvite.stateId, roleId: accessInvite.roleId },
        });
      }

      await tx.accessInvite.update({
        where: { id: accessInvite.id },
        data: { status: "ACCEPTED", acceptedByUserId: uid },
      });

      return uid;
    });

    const tokenJwt = jwt.sign({ id: userId }, appConfig.jwt.secret, { expiresIn: "7d" });
    res.cookie("access_token", tokenJwt, getAccessTokenCookieOptions());

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { auth: true, profile: true },
    });

    return res.json({
      success: true,
      message: "Invite accepted",
      token: tokenJwt,
      user: {
        id: userId,
        email: user?.auth?.email || null,
        phone: user?.auth?.phone || null,
        displayName: user?.profile?.displayName || null,
        username: user?.profile?.username || null,
      },
      data: { scopeType: accessInvite.scopeType, roleId: accessInvite.roleId },
    });
  } catch (e: any) {
    if (e?.statusCode) {
      return res.status(e.statusCode).json({ success: false, message: e.message });
    }
    if (String(e?.code) === "P2002") {
      return res.status(409).json({ success: false, message: "Conflict: unique constraint failed" });
    }
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * STAFF LOGIN
 * Body: { email? or phone?, password }
 * Only allows users with BranchMember or OrgMember records (staff members)
 * Owners can also use this to access staff view of their branches
 * Uses shared authUnified.service; returns canonical contexts + default_redirect.
 */
exports.staffLogin = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    console.info("[AUTH_STAFF_LOGIN_ACTIVE_MARKER_V3] start", {
      file: __filename,
      hasEmail: !!email,
      hasPhone: !!phone,
    });

    // Shared credential verification + staff-only gate
    let authRow;
    try {
      const result = await verifyCredentials({
        email: email || null,
        phone: phone || null,
        password: password || "",
      });
      authRow = result.authRow;
    } catch (credErr) {
      const code = credErr.statusCode || 400;
      return res.status(code).json({ success: false, message: credErr.message || "Invalid credentials" });
    }

    // Check for staff memberships (BranchMember or OrgMember)
    const [branchMembers, orgMembers] = await Promise.all([
      prisma.branchMember.findMany({
        where: { userId: authRow.user.id, status: "ACTIVE" },
        include: {
          branch: {
            select: {
              id: true,
              name: true,
              orgId: true,
              types: {
                select: {
                  type: {
                    select: {
                      code: true,
                      nameEn: true,
                    },
                  },
                },
              },
            },
          },
          roles: { include: { role: true } },
        },
      }),
      prisma.orgMember.findMany({
        where: { userId: authRow.user.id, status: "ACTIVE" },
        include: {
          org: { select: { id: true, name: true } },
          roles: { include: { role: true } },
        },
      }),
    ]);

    // Check if user is an owner (for implicit staff access)
    const ownerProfile = await prisma.ownerProfile.findUnique({
      where: { userId: authRow.user.id },
      select: { id: true },
    });

    const ownedOrgs = await prisma.organization.findMany({
      where: { ownerUserId: authRow.user.id },
      select: { id: true, name: true },
    });

    const isOwner = Boolean(ownerProfile || ownedOrgs.length > 0);

    // If user has no staff memberships and is not an owner, reject
    if (branchMembers.length === 0 && orgMembers.length === 0 && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "This account does not have staff access. Please use owner login if you are an owner.",
      });
    }

    // For owners, get all branches from their organizations (implicit staff access)
    let accessibleBranches = branchMembers.map((bm) => ({
      id: bm.branch.id,
      name: bm.branch.name,
      orgId: bm.branch.orgId,
      type: bm.branch.types?.[0]?.type?.code || null,
      typeName: bm.branch.types?.[0]?.type?.nameEn || null,
      role: bm.role,
      membershipType: "EXPLICIT",
    }));

    if (isOwner && ownedOrgs.length > 0) {
      const ownerBranches = await prisma.branch.findMany({
        where: {
          orgId: { in: ownedOrgs.map((o) => o.id) },
        },
        select: {
          id: true,
          name: true,
          orgId: true,
          types: {
            select: {
              type: {
                select: {
                  code: true,
                  nameEn: true,
                },
              },
            },
          },
        },
      });

      // Add owner branches that aren't already in accessibleBranches
      for (const branch of ownerBranches) {
        if (!accessibleBranches.find((b) => b.id === branch.id)) {
          accessibleBranches.push({
            id: branch.id,
            name: branch.name,
            orgId: branch.orgId,
            type: branch.types?.[0]?.type?.code || null,
            typeName: branch.types?.[0]?.type?.nameEn || null,
            role: "OWNER",
            membershipType: "IMPLICIT",
          });
        }
      }
    }

    // Canonical redirect (backend is source of truth)
    const contexts = await resolveAuthContexts(authRow.user.id);
    const default_redirect = await decideRedirect(authRow.user.id, contexts, { forceStaffPanel: true });

    const userType = isOwner ? "OWNER" : "STAFF";
    const payload = { id: authRow.user.id, userType };
    console.info("[AUTH_STAFF_LOGIN_ACTIVE_MARKER_V3] payload", {
      file: __filename,
      payloadKeys: Object.keys(payload),
      hasPerms: Object.prototype.hasOwnProperty.call(payload, "perms"),
    });
    const token = jwt.sign(payload, appConfig.jwt.secret, { expiresIn: "7d" });

    const tokenBytes = Buffer.byteLength(token, "utf8");
    console.info("[AUTH_STAFF_LOGIN_ACTIVE_MARKER_V3] token", { file: __filename, tokenBytes, cookieLimitNote: "browsers ~4096" });

    // Set HttpOnly cookie (no Domain in dev = host-only).
    res.cookie("access_token", token, getAccessTokenCookieOptions());

    return res.status(200).json({
      success: true,
      message: "Staff login successful",
      token,
      user: {
        id: authRow.user.id,
        email: authRow.email || null,
        phone: authRow.phone || null,
        displayName: authRow.user.profile?.displayName || null,
        username: authRow.user.profile?.username || null,
        userType: isOwner ? "OWNER" : "STAFF",
        redirectPath: default_redirect,
        branches: accessibleBranches,
      },
      contexts,
      default_redirect,
    });
  } catch (error) {
    console.error("Staff Login Error:", error);
    return res.status(500).json({ success: false, message: "Login failed", error: error.message });
  }
};

/**
 * GET /api/v1/auth/staff/context
 * Returns all branches user has staff access to (including implicit owner access)
 */
exports.getStaffContext = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    // Get explicit staff memberships
    const [branchMembers, orgMembers] = await Promise.all([
      prisma.branchMember.findMany({
        where: { userId: userId, status: "ACTIVE" },
        include: {
          branch: {
            select: {
              id: true,
              name: true,
              orgId: true,
              types: {
                select: {
                  type: {
                    select: {
                      code: true,
                      nameEn: true,
                    },
                  },
                },
              },
            },
          },
          roles: { include: { role: true } },
        },
      }),
      prisma.orgMember.findMany({
        where: { userId: userId, status: "ACTIVE" },
        include: {
          org: { select: { id: true, name: true } },
          roles: { include: { role: true } },
        },
      }),
    ]);

    // Check if user is an owner
    const ownerProfile = await prisma.ownerProfile.findUnique({
      where: { userId: userId },
      select: { id: true },
    });

    const ownedOrgs = await prisma.organization.findMany({
      where: { ownerUserId: userId },
      select: { id: true, name: true },
    });

    const isOwner = Boolean(ownerProfile || ownedOrgs.length > 0);

    // Get branch access permissions for all branches
    const branchIds = branchMembers.map((bm) => bm.branch.id);
    const accessPermissions = branchIds.length > 0
      ? await prisma.branchAccessPermission.findMany({
          where: {
            userId: userId,
            branchId: { in: branchIds },
          },
          select: {
            branchId: true,
            status: true,
            expiresAt: true,
          },
        })
      : [];

    const accessMap = new Map();
    accessPermissions.forEach((ap) => {
      // Check if expired
      if (ap.status === "APPROVED" && ap.expiresAt && new Date(ap.expiresAt) < new Date()) {
        accessMap.set(ap.branchId, "EXPIRED");
      } else {
        accessMap.set(ap.branchId, ap.status);
      }
    });

    // Build accessible branches list with access status
    let accessibleBranches = branchMembers.map((bm) => {
      const accessStatus = accessMap.get(bm.branch.id) || "PENDING";
      const permission = accessPermissions.find((ap) => ap.branchId === bm.branch.id);

      return {
        id: bm.branch.id,
        name: bm.branch.name,
        orgId: bm.branch.orgId,
        type: bm.branch.types?.[0]?.type?.code || null,
        typeName: bm.branch.types?.[0]?.type?.nameEn || null,
        role: bm.role,
        membershipType: "EXPLICIT",
        accessStatus: accessStatus,
        accessExpiresAt: permission?.expiresAt || null,
      };
    });

    // Add owner branches (implicit access)
    if (isOwner && ownedOrgs.length > 0) {
      const ownerBranches = await prisma.branch.findMany({
        where: {
          orgId: { in: ownedOrgs.map((o) => o.id) },
        },
        select: {
          id: true,
          name: true,
          orgId: true,
          types: {
            select: {
              type: {
                select: {
                  code: true,
                  nameEn: true,
                },
              },
            },
          },
        },
      });

      for (const branch of ownerBranches) {
        if (!accessibleBranches.find((b) => b.id === branch.id)) {
          // Owners have implicit APPROVED access
          accessibleBranches.push({
            id: branch.id,
            name: branch.name,
            orgId: branch.orgId,
            type: branch.types?.[0]?.type?.code || null,
            typeName: branch.types?.[0]?.type?.nameEn || null,
            role: "OWNER",
            membershipType: "IMPLICIT",
            accessStatus: "APPROVED", // Owners always have access
            accessExpiresAt: null,
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        branches: accessibleBranches,
        isOwner: isOwner,
        userType: isOwner ? "OWNER" : "STAFF",
      },
    });
  } catch (error) {
    console.error("getStaffContext Error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

export {};
