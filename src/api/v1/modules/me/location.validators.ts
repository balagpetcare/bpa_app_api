/**
 * Validators for /api/v1/me/location endpoints
 */

const LOCATION_SOURCES = ["GPS", "IP", "MANUAL", "WIFI", "CELL"] as const;
const EVENT_TYPES_EVENTS = ["PING", "SIGNIFICANT_MOVE"] as const;

export type LocationSource = (typeof LOCATION_SOURCES)[number];
export type LocationEventTypeForEvents = (typeof EVENT_TYPES_EVENTS)[number];

export interface LocationEventBody {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  source: LocationSource;
  eventType: LocationEventTypeForEvents;
  timestamp?: Date;
  sessionId?: string;
  deviceId?: string;
}

export interface LocationPlaceInput {
  countryCode: string;
  admin1?: string;
  admin2?: string;
  city?: string;
  postalCode?: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  bdDivision?: string;
  bdDistrict?: string;
  bdUpazila?: string;
  bdWard?: string;
}

export interface LocationManualBody {
  place: LocationPlaceInput;
}

export function validateLocationEventBody(body: unknown): { ok: true; data: LocationEventBody } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body is required" };
  }
  const b = body as Record<string, unknown>;
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "lat and lng are required numbers" };
  }
  const source = b.source as string;
  if (!LOCATION_SOURCES.includes(source as LocationSource)) {
    return { ok: false, message: `source must be one of: ${LOCATION_SOURCES.join(", ")}` };
  }
  const eventType = b.eventType as string;
  if (!EVENT_TYPES_EVENTS.includes(eventType as LocationEventTypeForEvents)) {
    return { ok: false, message: `eventType must be one of: ${EVENT_TYPES_EVENTS.join(", ")}` };
  }
  const accuracyMeters = b.accuracyMeters != null ? Number(b.accuracyMeters) : undefined;
  if (accuracyMeters != null && (!Number.isFinite(accuracyMeters) || accuracyMeters < 0)) {
    return { ok: false, message: "accuracyMeters must be a non-negative number" };
  }
  let timestamp: Date | undefined;
  if (b.timestamp != null) {
    const ts = typeof b.timestamp === "string" ? new Date(b.timestamp) : new Date(Number(b.timestamp));
    if (Number.isNaN(ts.getTime())) {
      return { ok: false, message: "timestamp must be a valid ISO date string or number" };
    }
    timestamp = ts;
  }
  const sessionId = b.sessionId != null ? String(b.sessionId).slice(0, 255) : undefined;
  const deviceId = b.deviceId != null ? String(b.deviceId).slice(0, 255) : undefined;

  return {
    ok: true,
    data: {
      lat,
      lng,
      accuracyMeters,
      source: source as LocationSource,
      eventType: eventType as LocationEventTypeForEvents,
      timestamp,
      sessionId,
      deviceId,
    },
  };
}

export function validateLocationManualBody(body: unknown): { ok: true; data: LocationPlaceInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body is required" };
  }
  const b = body as Record<string, unknown>;
  const place = b.place;
  if (!place || typeof place !== "object") {
    return { ok: false, message: "place is required" };
  }
  const p = place as Record<string, unknown>;
  const countryCode = p.countryCode != null ? String(p.countryCode).trim() : "";
  if (!countryCode) {
    return { ok: false, message: "place.countryCode is required" };
  }
  const admin1 = p.admin1 != null ? String(p.admin1).slice(0, 255) : undefined;
  const admin2 = p.admin2 != null ? String(p.admin2).slice(0, 255) : undefined;
  const city = p.city != null ? String(p.city).slice(0, 255) : undefined;
  const postalCode = p.postalCode != null ? String(p.postalCode).slice(0, 64) : undefined;
  const formattedAddress = p.formattedAddress != null ? String(p.formattedAddress).slice(0, 1024) : undefined;
  const lat = p.lat != null ? Number(p.lat) : undefined;
  const lng = p.lng != null ? Number(p.lng) : undefined;
  if (lat != null && !Number.isFinite(lat)) {
    return { ok: false, message: "place.lat must be a number" };
  }
  if (lng != null && !Number.isFinite(lng)) {
    return { ok: false, message: "place.lng must be a number" };
  }
  const bdDivision = p.bdDivision != null ? String(p.bdDivision).slice(0, 255) : undefined;
  const bdDistrict = p.bdDistrict != null ? String(p.bdDistrict).slice(0, 255) : undefined;
  const bdUpazila = p.bdUpazila != null ? String(p.bdUpazila).slice(0, 255) : undefined;
  const bdWard = p.bdWard != null ? String(p.bdWard).slice(0, 64) : undefined;

  return {
    ok: true,
    data: {
      countryCode: countryCode.slice(0, 2),
      admin1,
      admin2,
      city,
      postalCode,
      formattedAddress,
      lat,
      lng,
      bdDivision,
      bdDistrict,
      bdUpazila,
      bdWard,
    },
  };
}
