/**
 * Owner Delegation & Team Management Controller
 */
export {};

const {
  getOwnerTeams,
  getTeamMembersForDashboard,
  createOwnerTeam,
  addTeamMember,
  removeTeamMember,
  getDelegationsForUser,
  assignDelegation,
  revokeDelegation,
  revokeAllDelegationsForUser,
  setTeamForUser,
  getPermissionScopes,
  getOwnerOrgIds,
} = require("../../services/ownerDelegation.service");
const { writeOwnerOverviewLog, OVERVIEW_ACTIONS } = require("../../services/ownerOverviewLog.service");
const {
  createTeamInvitation,
  listTeamInvitations,
  listOwnerInvitations,
  resendTeamInvitation,
  cancelTeamInvitation,
} = require("../../services/teamInvitation.service");
const db = require("../../../../infrastructure/db/prismaClient").default;

/** GET /owner/teams */
async function listTeams(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const teams = await getOwnerTeams(ownerUserId);
    return res.status(200).json({ success: true, data: teams });
  } catch (e) {
    console.error("[ownerDelegation] listTeams:", e);
    return res.status(500).json({ success: false, error: "Server error" });
  }
}

/** POST /owner/teams - body: { name, description?, scopes? }. owner_id is set from auth (req.user.id). */
async function createTeam(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { name, description, scopes } = req.body || {};
    const trimmedName = name != null ? String(name).trim() : "";
    if (!trimmedName) {
      return res.status(400).json({ success: false, error: "Team name is required" });
    }

    const scopeList = Array.isArray(scopes) ? scopes : scopes != null ? [scopes] : [];
    const { isValidScopeKey } = require("../../constants/delegationScopes");
    for (const key of scopeList) {
      const k = String(key).trim();
      if (k && !isValidScopeKey(k)) {
        return res.status(400).json({ success: false, error: `Invalid scope: ${k}` });
      }
    }
    const validScopes = scopeList.map((s) => String(s).trim()).filter(Boolean);

    const team = await createOwnerTeam(ownerUserId, trimmedName, description?.trim() || undefined, validScopes);
    await writeOwnerOverviewLog(ownerUserId, OVERVIEW_ACTIONS.TEAM_CREATED, { teamId: team.id, name: team.name }, ownerUserId);

    return res.status(201).json({ success: true, data: team });
  } catch (e: any) {
    console.error("[ownerDelegation] createTeam:", e);
    const msg = e?.message || "Server error";
    const status = msg.includes("already exists") ? 409 : msg.includes("Invalid scope") ? 400 : 500;
    return res.status(status).json({ success: false, error: msg });
  }
}

/** POST /owner/teams/:teamId/invite - body: { email, scopes?, branchIds? }. Returns { invite, rawToken } (send token in email). */
async function inviteToTeam(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const teamId = parseInt(req.params.teamId, 10);
    const { email, scopes, branchIds } = req.body || {};
    if (isNaN(teamId) || !email) {
      return res.status(400).json({ success: false, error: "teamId and email are required" });
    }

    const { invite, rawToken } = await createTeamInvitation(
      ownerUserId,
      teamId,
      email,
      ownerUserId,
      Array.isArray(scopes) ? scopes : undefined,
      Array.isArray(branchIds) ? branchIds : undefined
    );
    await writeOwnerOverviewLog(
      ownerUserId,
      OVERVIEW_ACTIONS.MEMBER_ADDED,
      { teamId, email: invite.email, inviteId: invite.id },
      ownerUserId
    );

    return res.status(201).json({
      success: true,
      data: {
        inviteId: invite.id,
        email: invite.email,
        expiresAt: invite.expiresAt,
        rawToken,
      },
    });
  } catch (e) {
    console.error("[ownerDelegation] inviteToTeam:", e);
    return res.status(500).json({ success: false, error: (e as Error).message || "Server error" });
  }
}

/** GET /owner/teams/:teamId/invitations - list pending/accepted invitations for the team */
async function listInvitations(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const teamId = parseInt(req.params.teamId, 10);
    if (isNaN(teamId)) return res.status(400).json({ success: false, error: "Invalid teamId" });
    const list = await listTeamInvitations(ownerUserId, teamId);
    return res.status(200).json({ success: true, data: list });
  } catch (e) {
    console.error("[ownerDelegation] listInvitations:", e);
    return res.status(500).json({ success: false, error: (e as Error).message || "Server error" });
  }
}

/** POST /owner/teams/:teamId/members */
async function addMember(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const teamId = parseInt(req.params.teamId, 10);
    const { userId, roleInTeam } = req.body || {};
    const uid = userId != null ? parseInt(String(userId), 10) : NaN;
    if (isNaN(teamId) || isNaN(uid)) {
      return res.status(400).json({ success: false, message: "teamId and userId are required" });
    }

    await addTeamMember(teamId, ownerUserId, uid, roleInTeam?.trim() || undefined);
    await writeOwnerOverviewLog(ownerUserId, OVERVIEW_ACTIONS.MEMBER_ADDED, { teamId, userId: uid }, ownerUserId);

    return res.status(200).json({ success: true, message: "Member added" });
  } catch (e) {
    console.error("[ownerDelegation] addMember:", e);
    return res.status(500).json({ success: false, message: (e as Error).message || "Server error" });
  }
}

/** DELETE /owner/teams/:teamId/members/:userId */
async function removeMember(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const teamId = parseInt(req.params.teamId, 10);
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(teamId) || isNaN(userId)) {
      return res.status(400).json({ success: false, message: "teamId and userId are required" });
    }

    await removeTeamMember(teamId, ownerUserId, userId);
    await writeOwnerOverviewLog(ownerUserId, OVERVIEW_ACTIONS.MEMBER_REMOVED, { teamId, userId }, ownerUserId);

    return res.status(200).json({ success: true, message: "Member removed" });
  } catch (e) {
    console.error("[ownerDelegation] removeMember:", e);
    return res.status(500).json({ success: false, message: (e as Error).message || "Server error" });
  }
}

/** GET /owner/delegations/scopes */
async function listScopes(req, res) {
  try {
    const scopes = await getPermissionScopes();
    return res.status(200).json({ success: true, data: scopes });
  } catch (e) {
    console.error("[ownerDelegation] listScopes:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/** POST /owner/delegations */
async function assign(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { delegatedUserId, scopeKey, orgId, branchId, teamId } = req.body || {};
    const did = delegatedUserId != null ? parseInt(String(delegatedUserId), 10) : NaN;
    if (!scopeKey || isNaN(did)) {
      return res.status(400).json({ success: false, message: "delegatedUserId and scopeKey are required" });
    }

    const options: { orgId?: number; branchId?: number; teamId?: number } = {};
    if (orgId != null) options.orgId = parseInt(String(orgId), 10);
    if (branchId != null) options.branchId = parseInt(String(branchId), 10);
    if (teamId != null) options.teamId = parseInt(String(teamId), 10);

    const delegation = await assignDelegation(ownerUserId, did, String(scopeKey).trim(), options);
    await writeOwnerOverviewLog(
      ownerUserId,
      OVERVIEW_ACTIONS.DELEGATION_ASSIGNED,
      { delegationId: delegation.id, delegatedUserId: did, scopeKey: delegation.scopeKey },
      ownerUserId
    );

    return res.status(200).json({ success: true, data: delegation });
  } catch (e) {
    console.error("[ownerDelegation] assign:", e);
    return res.status(500).json({ success: false, message: (e as Error).message || "Server error" });
  }
}

/** POST /owner/delegations/revoke */
async function revoke(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { delegatedUserId, scopeKey, orgId, branchId } = req.body || {};
    const did = delegatedUserId != null ? parseInt(String(delegatedUserId), 10) : NaN;
    if (!scopeKey || isNaN(did)) {
      return res.status(400).json({ success: false, message: "delegatedUserId and scopeKey are required" });
    }

    const oid = orgId != null ? parseInt(String(orgId), 10) : null;
    const bid = branchId != null ? parseInt(String(branchId), 10) : null;
    await revokeDelegation(ownerUserId, did, String(scopeKey).trim(), oid, bid);
    await writeOwnerOverviewLog(
      ownerUserId,
      OVERVIEW_ACTIONS.DELEGATION_REVOKED,
      { delegatedUserId: did, scopeKey },
      ownerUserId
    );

    return res.status(200).json({ success: true, message: "Delegation revoked" });
  } catch (e) {
    console.error("[ownerDelegation] revoke:", e);
    return res.status(500).json({ success: false, message: (e as Error).message || "Server error" });
  }
}

/** POST /owner/delegations/revoke-all - body: { delegatedUserId } */
async function revokeAll(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const delegatedUserId = req.body?.delegatedUserId != null ? parseInt(String(req.body.delegatedUserId), 10) : NaN;
    if (isNaN(delegatedUserId)) {
      return res.status(400).json({ success: false, error: "delegatedUserId is required" });
    }

    const count = await revokeAllDelegationsForUser(ownerUserId, delegatedUserId);
    await writeOwnerOverviewLog(
      ownerUserId,
      OVERVIEW_ACTIONS.DELEGATION_REVOKED_ALL,
      { delegatedUserId, count },
      ownerUserId
    );

    return res.status(200).json({ success: true, message: "All delegations revoked", count });
  } catch (e) {
    console.error("[ownerDelegation] revokeAll:", e);
    return res.status(500).json({ success: false, error: (e as Error).message || "Server error" });
  }
}

/** POST /owner/delegations/set-team - body: { delegatedUserId, teamId } */
async function setTeam(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const delegatedUserId = req.body?.delegatedUserId != null ? parseInt(String(req.body.delegatedUserId), 10) : NaN;
    const teamId = req.body?.teamId != null ? parseInt(String(req.body.teamId), 10) : NaN;
    if (isNaN(delegatedUserId) || isNaN(teamId)) {
      return res.status(400).json({ success: false, error: "delegatedUserId and teamId are required" });
    }

    const count = await setTeamForUser(ownerUserId, delegatedUserId, teamId);
    await writeOwnerOverviewLog(
      ownerUserId,
      OVERVIEW_ACTIONS.TEAM_UPDATED,
      { delegatedUserId, teamId, delegationsUpdated: count },
      ownerUserId
    );

    return res.status(200).json({ success: true, message: "Team set for user", count });
  } catch (e) {
    console.error("[ownerDelegation] setTeam:", e);
    return res.status(500).json({ success: false, error: (e as Error).message || "Server error" });
  }
}

/** GET /owner/overview */
async function getOverview(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const [teams, delegations, orgIds] = await Promise.all([
      getOwnerTeams(ownerUserId),
      db.ownerDelegation.findMany({
        where: { ownerUserId },
        include: {
          delegatedUser: {
            select: {
              id: true,
              profile: { select: { displayName: true } },
              auth: { select: { email: true } },
            },
          },
          org: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      getOwnerOrgIds(ownerUserId),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        teams,
        delegations,
        orgIds,
      },
    });
  } catch (e) {
    console.error("[ownerDelegation] getOverview:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

/** GET /owner/team/members - flat list for dashboard table (name, email, team, role, scopes, branchAccessCount). */
async function listTeamMembers(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const members = await getTeamMembersForDashboard(ownerUserId);
    return res.status(200).json({ success: true, data: members });
  } catch (e) {
    console.error("[ownerDelegation] listTeamMembers:", e);
    return res.status(500).json({ success: false, error: (e as Error).message || "Server error" });
  }
}

/** GET /owner/team/invitations - all invitations for current owner (for team dashboard). */
async function listTeamDashboardInvitations(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const statusFilter = req.query?.status ? String(req.query.status).toUpperCase() : null;
    const list = await listOwnerInvitations(ownerUserId, statusFilter || undefined);
    return res.status(200).json({ success: true, data: list });
  } catch (e) {
    console.error("[ownerDelegation] listTeamDashboardInvitations:", e);
    return res.status(500).json({ success: false, error: (e as Error).message || "Server error" });
  }
}

/** GET /owner/team/overview - counts for team dashboard (teams, members, pending invites, active contexts). */
async function getTeamOverview(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const teams = await getOwnerTeams(ownerUserId);
    const teamIds = teams.map((t) => t.id);
    const [membersCount, pendingInvitesCount, activeContextsCount] = await Promise.all([
      teamIds.length === 0
        ? 0
        : db.ownerTeamMember.count({ where: { teamId: { in: teamIds } } }),
      teamIds.length === 0
        ? 0
        : db.teamInvitation.count({
            where: { ownerUserId, teamId: { in: teamIds }, status: "PENDING" },
          }),
      db.userContext.count({ where: { ownerUserId } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        teamsCount: teams.length,
        membersCount,
        pendingInvitesCount,
        activeContextsCount,
      },
    });
  } catch (e) {
    console.error("[ownerDelegation] getTeamOverview:", e);
    return res.status(500).json({ success: false, error: (e as Error).message || "Server error" });
  }
}

/** POST /owner/team/invitations/:id/resend - new token for pending invite; returns { invite, rawToken }. */
async function resendTeamInvitationHandler(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const id = req.params?.id;
    if (!id) return res.status(400).json({ success: false, error: "Invitation id required" });

    const { invite, rawToken } = await resendTeamInvitation(Number(id), ownerUserId);
    return res.status(200).json({ success: true, data: { invite, rawToken } });
  } catch (e) {
    const msg = (e as Error).message || "Server error";
    if (msg.includes("not found") || msg.includes("Only PENDING")) {
      return res.status(400).json({ success: false, error: msg });
    }
    console.error("[ownerDelegation] resendTeamInvitation:", e);
    return res.status(500).json({ success: false, error: msg });
  }
}

/** POST /owner/team/invitations/:id/cancel - revoke pending invite. */
async function cancelTeamInvitationHandler(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, error: "Unauthorized" });
    const id = req.params?.id;
    if (!id) return res.status(400).json({ success: false, error: "Invitation id required" });

    await cancelTeamInvitation(Number(id), ownerUserId);
    return res.status(200).json({ success: true });
  } catch (e) {
    const msg = (e as Error).message || "Server error";
    if (msg.includes("not found") || msg.includes("Only PENDING")) {
      return res.status(400).json({ success: false, error: msg });
    }
    console.error("[ownerDelegation] cancelTeamInvitation:", e);
    return res.status(500).json({ success: false, error: msg });
  }
}

/** GET /owner/overview/logs */
async function getOverviewLogs(req, res) {
  try {
    const ownerUserId = req.user?.id;
    if (!ownerUserId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const limit = Math.min(parseInt(req.query?.limit as string, 10) || 50, 200);
    const logs = await db.ownerOverviewLog.findMany({
      where: { ownerUserId },
      include: {
        actor: {
          select: {
            id: true,
            profile: { select: { displayName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return res.status(200).json({ success: true, data: logs });
  } catch (e) {
    console.error("[ownerDelegation] getOverviewLogs:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = {
  listTeams,
  listTeamMembers,
  createTeam,
  inviteToTeam,
  listInvitations,
  listTeamDashboardInvitations,
  resendTeamInvitationHandler,
  cancelTeamInvitationHandler,
  addMember,
  removeMember,
  listScopes,
  assign,
  revoke,
  revokeAll,
  setTeam,
  getTeamOverview,
  getOverview,
  getOverviewLogs,
};
