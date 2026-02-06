/**
 * Location service for UserLocationProfile, LocationPlace, UserLocationEvent.
 * Requires LocationPlace, UserLocationProfile, UserLocationEvent models in Prisma schema.
 */
import type { PrismaClient } from "@prisma/client";
import type { LocationEventBody, LocationPlaceInput } from "./location.validators";
import { buildPlaceDedupeKey, normalizePlaceInput } from "./location.normalize";

const DEFAULT_PRECISION_LEVEL = "COARSE" as const;
const DEFAULT_CONSENT_LEVEL = "NONE" as const;

/**
 * POST /api/v1/me/location/events
 * Create UserLocationEvent, update UserLocationProfile (lastLat/lastLng, currentPlaceId if resolvable).
 */
export async function createLocationEvent(
  prisma: PrismaClient,
  userId: number,
  body: LocationEventBody
): Promise<{ eventId: number }> {
  const timestamp = body.timestamp ?? new Date();

  // TODO: Hook for external geocoding to resolve place from lat/lng.
  let placeId: number | null = null;
  const resolvable = false; // Without geocoding, do not create/assign place
  if (resolvable) {
    const place = await (prisma as any).locationPlace.create({
      data: {
        countryCode: "XX",
        lat: body.lat,
        lng: body.lng,
        source: body.source,
      },
    });
    placeId = place.id;
  }

  await ensureUserLocationProfile(prisma, userId);

  const [event] = await (prisma as any).$transaction([
    (prisma as any).userLocationEvent.create({
      data: {
        userId,
        timestamp,
        lat: body.lat,
        lng: body.lng,
        placeId,
        accuracyMeters: body.accuracyMeters,
        source: body.source,
        eventType: body.eventType,
        sessionId: body.sessionId,
        deviceId: body.deviceId,
      },
    }),
    (prisma as any).userLocationProfile.update({
      where: { userId },
      data: {
        lastLat: body.lat,
        lastLng: body.lng,
        lastUpdatedAt: new Date(),
        ...(placeId ? { currentPlaceId: placeId } : {}),
      },
    }),
  ]);

  return { eventId: event.id };
}

/**
 * POST /api/v1/me/location/manual
 * Upsert LocationPlace (dedupe by stable key), set manualOverridePlaceId + currentPlaceId, create MANUAL_SET event.
 */
export async function setManualLocation(
  prisma: PrismaClient,
  userId: number,
  placeInput: LocationPlaceInput
): Promise<{ placeId: number }> {
  const normalized = normalizePlaceInput(placeInput);
  const dedupeKey = buildPlaceDedupeKey(placeInput);

  const existing = await (prisma as any).locationPlace.findFirst({
    where: { sourcePlaceId: dedupeKey },
  });

  let place;
  if (existing) {
    place = await (prisma as any).locationPlace.update({
      where: { id: existing.id },
      data: {
        countryCode: normalized.countryCode,
        admin1: normalized.admin1,
        admin2: normalized.admin2,
        city: normalized.city,
        postalCode: normalized.postalCode,
        formattedAddress: normalized.formattedAddress,
        lat: normalized.lat,
        lng: normalized.lng,
        geoHash: normalized.geoHash,
        bdDivision: normalized.bdDivision,
        bdDistrict: normalized.bdDistrict,
        bdUpazila: normalized.bdUpazila,
        bdWard: normalized.bdWard,
      },
    });
  } else {
    place = await (prisma as any).locationPlace.create({
      data: {
        countryCode: normalized.countryCode,
        admin1: normalized.admin1,
        admin2: normalized.admin2,
        city: normalized.city,
        postalCode: normalized.postalCode,
        formattedAddress: normalized.formattedAddress,
        lat: normalized.lat,
        lng: normalized.lng,
        geoHash: normalized.geoHash,
        source: "MANUAL",
        sourcePlaceId: dedupeKey,
        bdDivision: normalized.bdDivision,
        bdDistrict: normalized.bdDistrict,
        bdUpazila: normalized.bdUpazila,
        bdWard: normalized.bdWard,
      },
    });
  }

  await ensureUserLocationProfile(prisma, userId);

  await (prisma as any).$transaction([
    (prisma as any).userLocationProfile.update({
      where: { userId },
      data: {
        manualOverridePlaceId: place.id,
        currentPlaceId: place.id,
        lastLat: normalized.lat ?? place.lat,
        lastLng: normalized.lng ?? place.lng,
        lastUpdatedAt: new Date(),
      },
    }),
    (prisma as any).userLocationEvent.create({
      data: {
        userId,
        timestamp: new Date(),
        lat: normalized.lat ?? place.lat ?? 0,
        lng: normalized.lng ?? place.lng ?? 0,
        placeId: place.id,
        source: "MANUAL",
        eventType: "MANUAL_SET",
      },
    }),
  ]);

  return { placeId: place.id };
}

/**
 * GET /api/v1/me/location
 * Return { profile, currentPlace, homePlace, manualOverridePlace, events, recentlyIn, inferredHomePlace }.
 * recentlyIn = most frequent city or admin1 from last 7 days. inferredHomePlace = most frequent place from last 30 days (manual override wins in controller).
 */
export async function getLocation(prisma: PrismaClient, userId: number) {
  const profile = await (prisma as any).userLocationProfile.findUnique({
    where: { userId },
    include: {
      homePlace: true,
      currentPlace: true,
      manualOverridePlace: true,
    },
  });

  const events = await (prisma as any).userLocationEvent.findMany({
    where: { userId },
    orderBy: { timestamp: "desc" },
    take: 20,
    select: {
      id: true,
      timestamp: true,
      lat: true,
      lng: true,
      placeId: true,
      source: true,
      eventType: true,
    },
  });

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const events7d = await (prisma as any).userLocationEvent.findMany({
    where: { userId, timestamp: { gte: since7d }, placeId: { not: null } },
    include: { place: { select: { city: true, admin1: true } } },
    orderBy: { timestamp: "desc" },
  });
  let recentlyIn: string | null = null;
  const labelCounts: Record<string, number> = {};
  for (const e of events7d) {
    const place = (e as any).place;
    const label = (place?.city?.trim() || place?.admin1?.trim() || "").slice(0, 255);
    if (label) {
      labelCounts[label] = (labelCounts[label] || 0) + 1;
    }
  }
  let maxCount = 0;
  for (const [label, count] of Object.entries(labelCounts)) {
    if (count > maxCount) {
      maxCount = count;
      recentlyIn = label;
    }
  }

  const events30d = await (prisma as any).userLocationEvent.findMany({
    where: { userId, timestamp: { gte: since30d }, placeId: { not: null } },
    select: { placeId: true },
  });
  const placeIdCounts: Record<number, number> = {};
  for (const e of events30d) {
    const pid = (e as any).placeId;
    if (pid != null) {
      placeIdCounts[pid] = (placeIdCounts[pid] || 0) + 1;
    }
  }
  let topPlaceId: number | null = null;
  let topCount = 0;
  for (const [pid, count] of Object.entries(placeIdCounts)) {
    const n = Number(pid);
    if (count > topCount && Number.isFinite(n)) {
      topCount = count;
      topPlaceId = n;
    }
  }
  let inferredHomePlace: ReturnType<typeof toLocationPlaceDto> | null = null;
  if (topPlaceId) {
    const place = await (prisma as any).locationPlace.findUnique({
      where: { id: topPlaceId },
    });
    if (place) inferredHomePlace = toLocationPlaceDto(place);
  }

  if (!profile) {
    return {
      profile: null,
      currentPlace: null,
      homePlace: null,
      manualOverridePlace: null,
      events,
      recentlyIn,
      inferredHomePlace,
    };
  }

  return {
    profile: {
      userId: profile.userId,
      homePlaceId: profile.homePlaceId,
      currentPlaceId: profile.currentPlaceId,
      manualOverridePlaceId: profile.manualOverridePlaceId,
      lastLat: profile.lastLat,
      lastLng: profile.lastLng,
      precisionLevel: profile.precisionLevel,
      consentLevel: profile.consentLevel,
      lastUpdatedAt: profile.lastUpdatedAt,
    },
    currentPlace: profile.currentPlace ? toLocationPlaceDto(profile.currentPlace) : null,
    homePlace: profile.homePlace ? toLocationPlaceDto(profile.homePlace) : null,
    manualOverridePlace: profile.manualOverridePlace ? toLocationPlaceDto(profile.manualOverridePlace) : null,
    events,
    recentlyIn,
    inferredHomePlace,
  };
}

function toLocationPlaceDto(p: any) {
  return {
    id: p.id,
    countryCode: p.countryCode,
    admin1: p.admin1,
    admin2: p.admin2,
    city: p.city,
    postalCode: p.postalCode,
    formattedAddress: p.formattedAddress,
    lat: p.lat,
    lng: p.lng,
    geoHash: p.geoHash,
    source: p.source,
    sourcePlaceId: p.sourcePlaceId,
    bdDivision: p.bdDivision,
    bdDistrict: p.bdDistrict,
    bdUpazila: p.bdUpazila,
    bdWard: p.bdWard,
  };
}

async function ensureUserLocationProfile(prisma: PrismaClient, userId: number) {
  const existing = await (prisma as any).userLocationProfile.findUnique({
    where: { userId },
  });
  if (!existing) {
    await (prisma as any).userLocationProfile.create({
      data: {
        userId,
        precisionLevel: DEFAULT_PRECISION_LEVEL,
        consentLevel: DEFAULT_CONSENT_LEVEL,
      },
    });
  }
}
