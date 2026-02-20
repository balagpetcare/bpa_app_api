/**
 * Place normalization and dedupe key (no external API calls).
 */
import { computeGeoHash } from "./geohash.util";

export interface PlaceLike {
  countryCode?: string | null;
  admin1?: string | null;
  admin2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  formattedAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  bdDivision?: string | null;
  bdDistrict?: string | null;
  bdUpazila?: string | null;
  bdWard?: string | null;
}

export interface NormalizedPlace {
  countryCode: string;
  admin1?: string;
  admin2?: string;
  city?: string;
  postalCode?: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  geoHash?: string;
  bdDivision?: string;
  bdDistrict?: string;
  bdUpazila?: string;
  bdWard?: string;
}

function trim(s: string | null | undefined, maxLen = 1024): string | undefined {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t === "" ? undefined : t.slice(0, maxLen);
}

/**
 * Normalize place input to canonical shape + compute geoHash when lat/lng present.
 */
export function normalizePlaceInput(place: PlaceLike): NormalizedPlace {
  const countryCode = trim(place.countryCode, 2) ?? "";
  const admin1 = trim(place.admin1, 255);
  const admin2 = trim(place.admin2, 255);
  const city = trim(place.city, 255);
  const postalCode = trim(place.postalCode, 64);
  const formattedAddress = trim(place.formattedAddress, 1024);
  const lat = place.lat != null && Number.isFinite(Number(place.lat)) ? Number(place.lat) : undefined;
  const lng = place.lng != null && Number.isFinite(Number(place.lng)) ? Number(place.lng) : undefined;
  const bdDivision = trim(place.bdDivision, 255);
  const bdDistrict = trim(place.bdDistrict, 255);
  const bdUpazila = trim(place.bdUpazila, 255);
  const bdWard = trim(place.bdWard, 64);

  let geoHash: string | undefined;
  if (lat != null && lng != null) {
    geoHash = computeGeoHash(lat, lng, 7);
  }

  return {
    countryCode,
    admin1,
    admin2,
    city,
    postalCode,
    formattedAddress,
    lat,
    lng,
    geoHash,
    bdDivision,
    bdDistrict,
    bdUpazila,
    bdWard,
  };
}

/**
 * Build stable dedupe key: countryCode + admin1 + admin2 + city + postal + rounded lat/lng
 */
export function buildPlaceDedupeKey(place: PlaceLike): string {
  const p = typeof place === "object" && place != null ? place : {};
  const countryCode = p.countryCode != null ? String(p.countryCode).trim().slice(0, 2) : "";
  const admin1 = p.admin1 != null ? String(p.admin1).trim() : "";
  const admin2 = p.admin2 != null ? String(p.admin2).trim() : "";
  const city = p.city != null ? String(p.city).trim() : "";
  const postalCode = p.postalCode != null ? String(p.postalCode).trim() : "";
  const lat = p.lat != null && Number.isFinite(Number(p.lat)) ? Number(p.lat).toFixed(5) : "";
  const lng = p.lng != null && Number.isFinite(Number(p.lng)) ? Number(p.lng).toFixed(5) : "";
  return [countryCode, admin1, admin2, city, postalCode, lat, lng].join("|");
}
