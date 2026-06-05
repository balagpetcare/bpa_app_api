/**
 * Shared OAuth sign-in / sign-up flow.
 * Issues the same JWT + access_token cookie as password login.
 */

import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AuthProvider } from "@prisma/client";
import prisma from "../../../infrastructure/db/prismaClient";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../../../config/appConfig") as {
  jwt: { secret: string; expiresIn?: string };
};
import { generateUniqueUsername } from "../utils/generateUniqueUsername";
import { applyProviderProfileBootstrap } from "./providerProfileBootstrap.service";
import type { VerifiedOAuthProfile } from "../providers/oauth/oauth.types";

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

function issueSession(res: Response, userId: number): string {
  const token = jwt.sign({ id: userId }, appConfig.jwt.secret, { expiresIn: "7d" });
  res.cookie("access_token", token, getAccessTokenCookieOptions());
  return token;
}

export async function performOAuthLogin(
  profile: VerifiedOAuthProfile,
  req: Request,
  res: Response
): Promise<{ status: number; body: Record<string, unknown> }> {
  const emailNorm = profile.email;

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
      return {
        status: 409,
        body: {
          success: false,
          code: "EMAIL_USES_PASSWORD",
          message:
            "This email is registered with a password. Sign in with email and password, or use account linking when available.",
        },
      };
    }
    if (existing.provider !== profile.provider) {
      return {
        status: 409,
        body: {
          success: false,
          code: "EMAIL_DIFFERENT_PROVIDER",
          message: "This email is associated with a different sign-in method.",
        },
      };
    }

    await prisma.userAuth.update({
      where: { userId: existing.userId },
      data: {
        oauthSubject: profile.oauthSubject,
        lastLoginAt: new Date(),
        emailVerifiedAt: profile.emailVerified
          ? new Date()
          : existing.emailVerifiedAt,
      },
    });

    await applyProviderProfileBootstrap(
      existing.userId,
      {
        providerKey: profile.providerKey,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        oauthSubject: profile.oauthSubject,
      },
      req
    );

    const token = issueSession(res, existing.userId);
    return {
      status: 200,
      body: {
        success: true,
        message: `${profile.providerKey} sign-in successful`,
        token,
        user: { id: existing.userId, email: emailNorm },
      },
    };
  }

  const displayName =
    (profile.displayName && profile.displayName.slice(0, 200)) ||
    emailNorm.split("@")[0] ||
    "User";
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
          provider: profile.provider,
          email: emailNorm,
          oauthSubject: profile.oauthSubject,
          passwordHash: null,
          emailVerifiedAt: profile.emailVerified ? new Date() : null,
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
      providerKey: profile.providerKey,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      oauthSubject: profile.oauthSubject,
    },
    req
  );

  await prisma.userAuth.update({
    where: { userId: created.id },
    data: { lastLoginAt: new Date() },
  });

  const token = issueSession(res, created.id);
  return {
    status: 201,
    body: {
      success: true,
      message: `Account created with ${profile.providerKey}`,
      token,
      user: { id: created.id, email: emailNorm },
    },
  };
}

export function mapOAuthError(error: unknown): { status: number; message: string } {
  const code = error instanceof Error ? error.message : "OAUTH_FAILED";

  const map: Record<string, { status: number; message: string }> = {
    GOOGLE_CLIENT_ID_MISSING: {
      status: 503,
      message: "Google sign-in is not configured (GOOGLE_CLIENT_ID missing).",
    },
    FACEBOOK_APP_CREDENTIALS_MISSING: {
      status: 503,
      message: "Facebook sign-in is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET missing).",
    },
    INVALID_GOOGLE_TOKEN: { status: 401, message: "Invalid Google token" },
    INVALID_FACEBOOK_TOKEN: { status: 401, message: "Invalid Facebook token" },
    FACEBOOK_TOKEN_WRONG_APP: { status: 401, message: "Facebook token was issued for a different app" },
    GOOGLE_TOKEN_MISSING_EMAIL_OR_SUBJECT: {
      status: 400,
      message: "Google token missing email or subject",
    },
    FACEBOOK_TOKEN_MISSING_EMAIL: {
      status: 400,
      message: "Facebook token missing email permission",
    },
    FACEBOOK_TOKEN_MISSING_USER_ID: {
      status: 400,
      message: "Facebook token missing user id",
    },
  };

  if (map[code]) return map[code];
  if (code.startsWith("FACEBOOK_API_ERROR_")) {
    return { status: 502, message: "Facebook API verification failed" };
  }

  return {
    status: 500,
    message: process.env.NODE_ENV !== "production" ? code : "OAuth sign-in failed",
  };
}
