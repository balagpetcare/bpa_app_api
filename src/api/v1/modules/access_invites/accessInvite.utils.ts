import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";

type CreateInviteArgs = {
  prisma: PrismaClient;
  scopeType: "COUNTRY" | "STATE";
  countryId?: number | null;
  stateId?: number | null;
  roleId: number;
  email: string;
  displayName?: string | null;
  invitedByUserId: number;
};

function normalizeEmail(v: string): string {
  return String(v || "").trim().toLowerCase();
}

export async function createAccessInvite(args: CreateInviteArgs) {
  const email = normalizeEmail(args.email);
  if (!email || !email.includes("@")) {
    throw Object.assign(new Error("Invalid email"), { statusCode: 400 });
  }

  const scopeType = String(args.scopeType || "").toUpperCase() as "COUNTRY" | "STATE";
  if (!["COUNTRY", "STATE"].includes(scopeType)) {
    throw Object.assign(new Error("Invalid scopeType"), { statusCode: 400 });
  }

  const role = await args.prisma.role.findUnique({
    where: { id: args.roleId },
    select: { id: true, key: true, label: true, scope: true },
  });
  if (!role) {
    throw Object.assign(new Error("Role not found"), { statusCode: 404 });
  }

  if (role.scope !== scopeType) {
    throw Object.assign(new Error("Role scope mismatch"), { statusCode: 400 });
  }

  let country = null;
  let state = null;

  if (scopeType === "COUNTRY") {
    if (!args.countryId) {
      throw Object.assign(new Error("countryId is required"), { statusCode: 400 });
    }
    country = await args.prisma.country.findUnique({
      where: { id: Number(args.countryId) },
      select: { id: true, code: true, name: true },
    });
    if (!country) throw Object.assign(new Error("Country not found"), { statusCode: 404 });
  }

  if (scopeType === "STATE") {
    if (!args.stateId) {
      throw Object.assign(new Error("stateId is required"), { statusCode: 400 });
    }
    state = await args.prisma.state.findUnique({
      where: { id: Number(args.stateId) },
      include: { country: { select: { id: true, code: true, name: true } } },
    });
    if (!state) throw Object.assign(new Error("State not found"), { statusCode: 404 });
    country = state.country;
  }

  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3); // 72h

  const invite = await args.prisma.accessInvite.create({
    data: {
      scopeType,
      countryId: country?.id || null,
      stateId: state?.id || null,
      roleId: role.id,
      status: "PENDING",
      email,
      displayName: args.displayName ? String(args.displayName) : null,
      tokenHash,
      expiresAt,
      invitedByUserId: args.invitedByUserId,
    },
  });

  return { invite, rawToken, role, country, state };
}

export async function sendAccessInviteEmail(params: {
  to: string;
  toName?: string | null;
  roleLabel: string;
  scopeLabel: string;
  inviteLink: string;
  expiresAt: Date;
}) {
  const { sendInvite } = require("../../../../utils/inviteNotifier");
  const { renderAccessInviteEmail } = require("../../../../utils/emailTemplates/accessInviteEmail");

  const rendered = renderAccessInviteEmail({
    toName: params.toName || null,
    roleLabel: params.roleLabel,
    scopeLabel: params.scopeLabel,
    inviteLink: params.inviteLink,
    expiresAt: params.expiresAt,
  });

  const msg = `BPA Invite: You are invited as ${params.roleLabel} for ${params.scopeLabel}. Complete registration: ${params.inviteLink}`;
  await sendInvite({
    channel: "EMAIL",
    to: params.to,
    message: msg,
    email: { subject: rendered.subject, html: rendered.html, text: rendered.text },
  });
}

