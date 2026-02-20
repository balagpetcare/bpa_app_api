import { Prisma } from "@prisma/client";
import { createAccessInvite, sendAccessInviteEmail } from "../access_invites/accessInvite.utils";

const prisma = require("../../../../infrastructure/db/prismaClient");

exports.list = async (req, res) => {
  try {
    const stateId = req.countryContext?.state?.stateId;
    if (!stateId) return res.status(400).json({ success: false, message: "State context required" });

    const where: Prisma.AccessInviteWhereInput = { stateId };
    const status = req.query?.status ? String(req.query.status).toUpperCase() : undefined;
    const email = req.query?.email ? String(req.query.email).toLowerCase().trim() : undefined;

    if (status) where.status = status as any;
    if (email) where.email = { contains: email, mode: "insensitive" };

    const rows = await prisma.accessInvite.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        role: { select: { id: true, key: true, label: true, scope: true } },
        country: { select: { id: true, code: true, name: true } },
        state: { select: { id: true, code: true, name: true } },
      },
      take: 200,
    });

    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error("state_access_invites.list error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const stateId = req.countryContext?.state?.stateId;
    if (!stateId) return res.status(400).json({ success: false, message: "State context required" });

    const roleId = Number(req.body?.roleId);
    const email = String(req.body?.email || "").trim();
    const displayName = req.body?.displayName ? String(req.body.displayName) : null;

    if (!roleId) return res.status(400).json({ success: false, message: "roleId is required" });
    if (!email) return res.status(400).json({ success: false, message: "email is required" });

    const { invite, rawToken, role, state, country } = await createAccessInvite({
      prisma,
      scopeType: "STATE",
      stateId,
      roleId,
      email,
      displayName,
      invitedByUserId: req.user?.id,
    });

    const base = String(process.env.PANEL_PUBLIC_URL || process.env.PUBLIC_WEB_URL || "").replace(/\/$/, "");
    const inviteLink = `${base}/register?invite=${rawToken}`;
    const scopeLabel = `State: ${state?.name || state?.code || "Unknown"} (${country?.code || ""})`;

    await sendAccessInviteEmail({
      to: invite.email,
      toName: invite.displayName || null,
      roleLabel: role.label || role.key,
      scopeLabel,
      inviteLink,
      expiresAt: invite.expiresAt,
    });

    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";

    return res.status(201).json({
      success: true,
      data: {
        id: invite.id,
        scopeType: invite.scopeType,
        countryId: invite.countryId,
        stateId: invite.stateId,
        roleId: invite.roleId,
        status: invite.status,
        email: invite.email,
        expiresAt: invite.expiresAt,
        ...(isProd ? {} : { devInviteToken: rawToken }),
      },
    });
  } catch (e: any) {
    const status = e?.statusCode || 500;
    return res.status(status).json({ success: false, message: e?.message || "Server error" });
  }
};

exports.revoke = async (req, res) => {
  try {
    const stateId = req.countryContext?.state?.stateId;
    if (!stateId) return res.status(400).json({ success: false, message: "State context required" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid invite id" });

    const invite = await prisma.accessInvite.findUnique({ where: { id } });
    if (!invite || invite.stateId !== stateId) {
      return res.status(404).json({ success: false, message: "Invite not found" });
    }

    const updated = await prisma.accessInvite.update({
      where: { id },
      data: { status: "REVOKED" },
    });

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("state_access_invites.revoke error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};

