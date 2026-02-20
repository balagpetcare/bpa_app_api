/**
 * Owner Onboarding: status and start.
 * GET /owner/onboarding/status - returns needsOnboarding, hasOrg, hasBranch, contextCount
 * POST /owner/onboarding/start - body: { organizationName?, branchName? } - creates org, branch, context
 */

const prisma = require("../../../../infrastructure/db/prismaClient").default;
const userContextService = require("../../services/userContext.service");

async function getOnboardingStatus(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const ownedOrgs = await prisma.organization.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const branchMemberCount = await prisma.branchMember.count({
      where: { userId, status: "ACTIVE" },
    });
    const contexts = await userContextService.listContexts(userId);
    const ownerProfile = await prisma.ownerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    const hasOrg = ownedOrgs.length > 0;
    const hasBranch = branchMemberCount > 0;
    const contextCount = contexts.length;
    const needsOnboarding =
      !ownerProfile && !hasOrg && !hasBranch && contextCount === 0;

    return res.status(200).json({
      success: true,
      data: {
        needsOnboarding,
        hasOrg,
        hasBranch,
        contextCount,
        step: needsOnboarding ? "start" : hasOrg && !hasBranch ? "branch" : "done",
      },
    });
  } catch (e) {
    console.error("[onboarding] status:", e);
    return res.status(500).json({ success: false, error: (e && e.message) || "Server error" });
  }
}

async function startOnboarding(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { organizationName, branchName } = req.body || {};
    const orgName = String(organizationName || "My Organization").trim() || "My Organization";
    const brName = String(branchName || "Main Branch").trim() || "Main Branch";

    const existingOrgs = await prisma.organization.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (existingOrgs.length > 0) {
      return res.status(400).json({
        success: false,
        error: "You already have an organization. Use the owner panel to add branches.",
      });
    }

    const org = await prisma.organization.create({
      data: {
        ownerUserId: userId,
        name: orgName,
        status: "PENDING_REVIEW",
      },
    });

    const branch = await prisma.branch.create({
      data: {
        orgId: org.id,
        name: brName,
        status: "DRAFT",
      },
    });

    await userContextService.createContext({
      userId,
      ownerUserId: userId,
      branchId: branch.id,
      teamId: null,
      roles: ["OWNER"],
      scopes: [],
      defaultDashboard: "owner",
      isDefault: true,
    });

    return res.status(201).json({
      success: true,
      data: {
        organizationId: org.id,
        organizationName: org.name,
        branchId: branch.id,
        branchName: branch.name,
        message: "Organization and branch created. You can now use the owner panel.",
      },
    });
  } catch (e) {
    console.error("[onboarding] start:", e);
    return res.status(500).json({ success: false, error: (e && e.message) || "Server error" });
  }
}

module.exports = {
  getOnboardingStatus,
  startOnboarding,
};
