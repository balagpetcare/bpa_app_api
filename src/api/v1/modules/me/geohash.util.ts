/**
 * Geohash encoding (no external API calls).
 * Uses standard base32 charset: 0123456789bcdefghjkmnpqrstuvwxyz
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/**
 * Compute geohash for given lat/lng with specified precision (default 7).
 * @param lat Latitude [-90, 90]
 * @param lng Longitude [-180, 180]
 * @param precision Character length (1-12 typical)
 */
export function computeGeoHash(lat: number, lng: number, precision = 7): string {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let isEven = true;
  let hash = "";
  let bits = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isEven) {
      const mid = (lngLo + lngHi) / 2;
      if (lng > mid) {
        ch = (ch << 1) | 1;
        lngLo = mid;
      } else {
        ch = (ch << 1) | 0;
        lngHi = mid;
      }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat > mid) {
        ch = (ch << 1) | 1;
        latLo = mid;
      } else {
        ch = (ch << 1) | 0;
        latHi = mid;
      }
    }
    isEven = !isEven;
    bits++;
    if (bits === 5) {
      hash += BASE32[ch];
      ch = 0;
      bits = 0;
    }
  }
  return hash;
}
