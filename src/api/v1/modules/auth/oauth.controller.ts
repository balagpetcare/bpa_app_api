/**
 * OAuth sign-in (Google implemented; other providers return 501 until configured).
 */

import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { AuthProvider } from "@prisma/client";
import prisma from "../../../../infrastructure/db/prismaClient";
// appConfig is CommonJS (module.exports)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../../../../config/appConfig") as {
  jwt: { secret: string; expiresIn?: string };
};
import { generateUniqueUsername } from "../../utils/generateUniqueUsername";
import { applyProviderProfileBootstrap } from "../../services/providerProfileBootstrap.service";

function getAccessTokenCookieOptions(): import("express").CookieOptions {
  const isProd = process.env.NODE_ENV === "production";
  const opts: import("express").CookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  };
  if (isProd && process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;
  return opts;
}

function issueSession(res: Response, userId: number) {
  const token = jwt.sign({ id: userId }, appConfig.jwt.secret, { expiresIn: "7d" });
  res.cookie("access_token", token, getAccessTokenCookieOptions());
  return token;
}

/**
 * POST /api/v1/auth/oauth/google
 * Body: { idToken: string }
 */
export async function googleIdTokenLogin(req: Request, res: Response) {
  try {
    const idToken = String((req.body as any)?.idToken || "").trim();
    if (!idToken) {
      return res.status(400).json({ success: false, message: "idToken is required" });
    }

    const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    if (!clientId) {
      return res.status(503).json({
        success: false,
        message: "Google sign-in is not configured (GOOGLE_CLIENT_ID missing).",
      });
    }

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({ success: false, message: "Invalid Google token" });
    }

    const sub = String(payload.sub || "").trim();
    const emailRaw = String(payload.email || "").trim().toLowerCase();
    const emailNorm = emailRaw || null;
    const name = payload.name ? String(payload.name).trim() : null;
    const picture = payload.picture ? String(payload.picture).trim() : null;

    if (!emailNorm || !sub) {
      return res.status(400).json({
        success: false,
        message: "Google token missing email or subject",
      });
    }

    const existing = await prisma.userAuth.findFirst({
      where: {
        email: { equals: emailNorm, mode: "insensitive" },
      },
      include: {
        user: { include: { profile: true } },
      },
    });

    if (existing) {
      if (existing.provider === AuthProvider.LOCAL && existing.passwordHash) {
        return res.status(409).json({
          success: false,
          code: "EMAIL_USES_PASSWORD",
          message:
            "This email is registered with a password. Sign in with email and password, or use account linking when available.",
        });
      }
      if (existing.provider !== AuthProvider.GOOGLE) {
        return res.status(409).json({
          success: false,
          code: "EMAIL_DIFFERENT_PROVIDER",
          message: "This email is associated with a different sign-in method.",
        });
      }

      await prisma.userAuth.update({
        where: { userId: existing.userId },
        data: {
          oauthSubject: sub,
          lastLoginAt: new Date(),
          emailVerifiedAt: payload.email_verified ? new Date() : existing.emailVerifiedAt,
        },
      });

      await applyProviderProfileBootstrap(
        existing.userId,
        {
          providerKey: "GOOGLE",
          displayName: name,
          pictureUrl: picture,
          oauthSubject: sub,
        },
        req
      );

      const token = issueSession(res, existing.userId);
      return res.status(200).json({
        success: true,
        message: "Google sign-in successful",
        token,
        user: { id: existing.userId, email: emailNorm },
      });
    }

    const displayName = (name && name.slice(0, 200)) || emailNorm.split("@")[0] || "User";
    const username = await generateUniqueUsername({
      emailNorm,
      phoneNorm: null,
      displayName,
    });

    const created = await prisma.user.create({
      data: {
        status: "ACTIVE",
        auth: {
          create: {
            provider: AuthProvider.GOOGLE,
            email: emailNorm,
            oauthSubject: sub,
            passwordHash: null,
            emailVerifiedAt: payload.email_verified ? new Date() : null,
          },
        },
        profile: {
          create: {
            displayName,
            username,
          },
        },
        wallet: {
          create: {
            balance: 0,
            points: 0,
            tier: "Bronze",
            currency: "BDT",
          },
        },
      },
      select: { id: true },
    });

    await applyProviderProfileBootstrap(
      created.id,
      {
        providerKey: "GOOGLE",
        displayName: name,
        pictureUrl: picture,
        oauthSubject: sub,
      },
      req
    );

    await prisma.userAuth.update({
      where: { userId: created.id },
      data: { lastLoginAt: new Date() },
    });

    const token = issueSession(res, created.id);
    return res.status(201).json({
      success: true,
      message: "Account created with Google",
      token,
      user: { id: created.id, email: emailNorm },
    });
  } catch (e: any) {
    console.error("googleIdTokenLogin:", e);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV !== "production" ? e?.message : "Google sign-in failed",
    });
  }
}

export async function facebookNotImplemented(_req: Request, res: Response) {
  return res.status(501).json({
    success: false,
    message: "Facebook sign-in is not enabled yet. Configure Facebook Login and token verification first.",
  });
}

export async function appleNotImplemented(_req: Request, res: Response) {
  return res.status(501).json({
    success: false,
    message: "Apple sign-in is not enabled yet. Configure Sign in with Apple first.",
  });
}

export async function twitterNotImplemented(_req: Request, res: Response) {
  return res.status(501).json({
    success: false,
    message: "X (Twitter) sign-in is not enabled yet. Configure OAuth 2.0 and token verification first.",
  });
}

const oauth = {
  googleIdTokenLogin,
  facebookNotImplemented,
  appleNotImplemented,
  twitterNotImplemented,
};

(module as any).exports = oauth;
export default oauth;
