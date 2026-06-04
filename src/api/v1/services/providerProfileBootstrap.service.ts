/**
 * OAuth provider profile snapshot + effective photo resolution (manual > provider > none).
 */

import type { Request } from "express";
import { AuditEntityType, Prisma } from "@prisma/client";
import prisma from "../../../infrastructure/db/prismaClient";

const { writeAudit } = require("../../../middlewares/auditWriter");

export type PhotoSource = "MANUAL" | "PROVIDER" | "NONE";

export type EffectivePhotoParts = {
  manualPhotoUrl: string | null;
  providerPhotoUrl: string | null;
  effectivePhotoUrl: string | null;
  photoSource: PhotoSource;
};

export function computeEffectivePhotoParts(profile: {
  avatarMedia?: { url?: string | null } | null;
  providerAvatarUrl?: string | null;
} | null): EffectivePhotoParts {
  const manual = profile?.avatarMedia?.url?.trim() || null;
  const provider = profile?.providerAvatarUrl?.trim() || null;
  if (manual) {
    return {
      manualPhotoUrl: manual,
      providerPhotoUrl: provider,
      effectivePhotoUrl: manual,
      photoSource: "MANUAL",
    };
  }
  if (provider) {
    return {
      manualPhotoUrl: null,
      providerPhotoUrl: provider,
      effectivePhotoUrl: provider,
      photoSource: "PROVIDER",
    };
  }
  return {
    manualPhotoUrl: null,
    providerPhotoUrl: null,
    effectivePhotoUrl: null,
    photoSource: "NONE",
  };
}

/** Attach effective photo fields to a profile object for JSON (auth/me, etc.). */
export function attachEffectivePhotoToProfile<T extends Record<string, unknown> | null | undefined>(
  profile: T
): T {
  if (!profile || typeof profile !== "object") return profile;
  const p = profile as Record<string, unknown>;
  const parts = computeEffectivePhotoParts({
    avatarMedia: p.avatarMedia as { url?: string | null } | undefined,
    providerAvatarUrl: p.providerAvatarUrl as string | null | undefined,
  });
  return {
    ...p,
    manualPhotoUrl: parts.manualPhotoUrl,
    providerPhotoUrl: parts.providerPhotoUrl,
    effectivePhotoUrl: parts.effectivePhotoUrl,
    photoSource: parts.photoSource,
  } as unknown as T;
}

export function isPlaceholderDisplayName(name: string | null | undefined): boolean {
  const s = String(name || "")
    .trim()
    .toLowerCase();
  if (!s) return true;
  const placeholders = new Set(["new user", "user", "bpa staff"]);
  return placeholders.has(s);
}

export type ProviderBootstrapInput = {
  providerKey: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  oauthSubject?: string | null;
};

/**
 * Upsert provider metadata on UserProfile; optionally hydrate displayName from provider if placeholder.
 * Never modifies avatarMediaId.
 */
export async function applyProviderProfileBootstrap(
  userId: number,
  input: ProviderBootstrapInput,
  req?: Request | null
): Promise<{ profile: Prisma.UserProfileGetPayload<{ include: { avatarMedia: true } }> }> {
  const key = String(input.providerKey || "").toUpperCase().slice(0, 32);
  const picture = input.pictureUrl?.trim() || null;
  const pname = input.displayName?.trim() || null;

  const before = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      displayName: true,
      providerSyncedAt: true,
      providerAvatarUrl: true,
      providerDisplayName: true,
    },
  });

  const currentName = before?.displayName ?? "";
  const shouldHydrateName = isPlaceholderDisplayName(currentName);

  const data: Prisma.UserProfileUpdateInput = {
    providerKey: key || undefined,
    providerDisplayName: pname,
    providerAvatarUrl: picture,
    providerSyncedAt: new Date(),
    ...(shouldHydrateName && pname
      ? { displayName: pname.slice(0, 200) }
      : {}),
  };

  await prisma.user.update({
    where: { id: userId },
    data: { profile: { update: data } },
  });

  const profile = await prisma.userProfile.findUniqueOrThrow({
    where: { userId },
    include: { avatarMedia: true },
  });

  const firstSync = !before?.providerSyncedAt;
  const action = firstSync ? "PROFILE_BOOTSTRAPPED_FROM_PROVIDER" : "PROVIDER_PROFILE_SYNCED";

  await writeAudit({
    prisma,
    req: req || ({} as Request),
    action,
    entityType: AuditEntityType.USER,
    entityId: String(userId),
    before: before ?? null,
    after: {
      providerKey: key,
      providerDisplayName: pname,
      providerAvatarUrl: picture ? "[url]" : null,
      displayNameUpdated: shouldHydrateName && pname ? true : false,
    },
  });

  return { profile };
}
