import { Prisma } from "@prisma/client";
import { createAccessInvite, sendAccessInviteEmail } from "../access_invites/accessInvite.utils";

const prisma = require("../../../../infrastructure/db/prismaClient");

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

exports.list = async (req, res) => {
  try {
    const countryId = req.countryContext?.countryId;
    if (!countryId) return res.status(400).json({ success: false, message: "Country context required" });

    const where: Prisma.AccessInviteWhereInput = { countryId };
    const scopeType = req.query?.scopeType ? String(req.query.scopeType).toUpperCase() : undefined;
    const status = req.query?.status ? String(req.query.status).toUpperCase() : undefined;
    const stateId = toInt(req.query?.stateId);
    const email = req.query?.email ? String(req.query.email).toLowerCase().trim() : undefined;

    if (scopeType) where.scopeType = scopeType as any;
    if (status) where.status = status as any;
    if (stateId) where.stateId = stateId;
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
    console.error("country_access_invites.list error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.create = async (req, res) => {
  try {
    const countryId = req.countryContext?.countryId;
    if (!countryId) return res.status(400).json({ success: false, message: "Country context required" });

    const scopeType = String(req.body?.scopeType || "COUNTRY").toUpperCase();
    const roleId = toInt(req.body?.roleId);
    const stateId = toInt(req.body?.stateId);
    const email = String(req.body?.email || "").trim();
    const displayName = req.body?.displayName ? String(req.body.displayName) : null;

    if (!roleId) return res.status(400).json({ success: false, message: "roleId is required" });
    if (!email) return res.status(400).json({ success: false, message: "email is required" });

    if (scopeType === "STATE") {
      if (!stateId) return res.status(400).json({ success: false, message: "stateId is required" });
      const state = await prisma.state.findUnique({
        where: { id: stateId },
        select: { id: true, countryId: true },
      });
      if (!state || state.countryId !== countryId) {
        return res.status(403).json({ success: false, message: "State is خارج of your country" });
      }
    }

    const { invite, rawToken, role, country, state } = await createAccessInvite({
      prisma,
      scopeType: scopeType as any,
      countryId,
      stateId: scopeType === "STATE" ? stateId : null,
      roleId,
      email,
      displayName,
      invitedByUserId: req.user?.id,
    });

    const base = String(
      process.env.COUNTRY_PANEL_PUBLIC_URL ||
        process.env.PANEL_PUBLIC_URL ||
        process.env.PUBLIC_WEB_URL ||
        "http://localhost:3106"
    ).replace(/\/$/, "");
    const inviteLink = `${base}/country/invite/${rawToken}`;
    const scopeLabel =
      invite.scopeType === "STATE"
        ? `State: ${state?.name || state?.code || "Unknown"}`
        : `Country: ${country?.name || country?.code || "Unknown"}`;

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
    const countryId = req.countryContext?.countryId;
    if (!countryId) return res.status(400).json({ success: false, message: "Country context required" });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid invite id" });

    const invite = await prisma.accessInvite.findUnique({ where: { id } });
    if (!invite || invite.countryId !== countryId) {
      return res.status(404).json({ success: false, message: "Invite not found" });
    }

    const updated = await prisma.accessInvite.update({
      where: { id },
      data: { status: "REVOKED" },
    });

    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("country_access_invites.revoke error", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export {};

