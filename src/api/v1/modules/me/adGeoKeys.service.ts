/**
 * Build geo targeting keys for ads (no external API calls).
 */
import { computeGeoHash } from "./geohash.util";

export interface PlaceForGeoKeys {
  countryCode?: string | null;
  admin1?: string | null;
  city?: string | null;
  postalCode?: string | null;
  geoHash?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface ProfileForGeoKeys {
  lastLat?: number | null;
  lastLng?: number | null;
}

export interface BuildGeoKeysParams {
  profile?: ProfileForGeoKeys | null;
  currentPlace?: PlaceForGeoKeys | null;
  homePlace?: PlaceForGeoKeys | null;
  recentPlaces?: Array<{ city?: string | null }> | null;
  /** Most frequent city or admin1 from last 7 days (single value for recently_in). */
  recentlyIn?: string | null;
}

function nonEmpty(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  return t === "" ? null : t;
}

/**
 * Build array of geo keys for ad targeting.
 * Keys: country:XX, admin1:..., city:..., postal:..., geohash:..., home:..., recently_in:<city>(7d)
 */
export function buildGeoKeys(params: BuildGeoKeysParams): string[] {
  const keys: string[] = [];
  const { profile, currentPlace, homePlace, recentPlaces, recentlyIn } = params;

  const primary = currentPlace ?? homePlace;

  if (primary?.countryCode) {
    keys.push(`country:${String(primary.countryCode).toUpperCase().slice(0, 2)}`);
  }
  const admin1 = nonEmpty(primary?.admin1);
  if (admin1) keys.push(`admin1:${admin1}`);
  const city = nonEmpty(primary?.city);
  if (city) keys.push(`city:${city}`);
  const postal = nonEmpty(primary?.postalCode);
  if (postal) keys.push(`postal:${postal}`);

  let geoHash = primary?.geoHash;
  if (!geoHash && (primary?.lat != null && primary?.lng != null) && Number.isFinite(primary.lat) && Number.isFinite(primary.lng)) {
    geoHash = computeGeoHash(Number(primary.lat), Number(primary.lng), 7);
  }
  if (!geoHash && profile?.lastLat != null && profile?.lastLng != null && Number.isFinite(profile.lastLat) && Number.isFinite(profile.lastLng)) {
    geoHash = computeGeoHash(Number(profile.lastLat), Number(profile.lastLng), 7);
  }
  if (geoHash) {
    keys.push(`geohash:${geoHash}`);
  }

  if (homePlace) {
    const homeLabel = nonEmpty(homePlace.city) ?? nonEmpty(homePlace.admin1) ?? nonEmpty(homePlace.countryCode);
    if (homeLabel) {
      keys.push(`home:${homeLabel}`);
    }
  }

  if (recentlyIn) {
    keys.push(`recently_in:${recentlyIn}(7d)`);
  } else if (recentPlaces?.length) {
    const cities = [...new Set(recentPlaces.map((p) => nonEmpty(p.city)).filter(Boolean) as string[])];
    for (const city of cities) {
      keys.push(`recently_in:${city}(7d)`);
    }
  }

  return keys;
}
