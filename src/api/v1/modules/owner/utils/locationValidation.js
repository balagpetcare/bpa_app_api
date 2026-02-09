/**
 * Standardized location schema validation for Organization / Branch.
 * Schema: { lat, lng, address, city, state, country, postalCode }
 * - lat, lng: required (numbers, valid range)
 * - country: required (non-empty string)
 * - address: optional, max 1000 chars
 */

const ADDRESS_MAX_LEN = 1000;
const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate and return a normalized location object for DB storage.
 * @param {object} input - req.body.location or similar
 * @returns {object} { lat, lng, address, city, state, country, postalCode } or null if input empty/invalid
 * @throws {Error} if location is provided but invalid
 */
function validateAndNormalizeLocation(input) {
  if (!input || typeof input !== 'object') return null;

  const lat = input.lat != null ? Number(input.lat) : input.latitude != null ? Number(input.latitude) : null;
  const lng = input.lng != null ? Number(input.lng) : input.longitude != null ? Number(input.longitude) : null;
  const country = input.country != null ? String(input.country).trim() : '';

  // If any location field is provided, we require lat, lng, country
  const hasAny = lat != null || lng != null || country !== '' ||
    (input.address || input.city || input.state || input.postalCode);

  if (!hasAny) return null;

  if (!isNum(lat) || lat < LAT_MIN || lat > LAT_MAX) {
    throw new Error('location.lat is required and must be a number between -90 and 90');
  }
  if (!isNum(lng) || lng < LNG_MIN || lng > LNG_MAX) {
    throw new Error('location.lng is required and must be a number between -180 and 180');
  }
  if (!country) {
    throw new Error('location.country is required');
  }

  let address = (input.address != null ? String(input.address) : '').trim();
  if (address.length > ADDRESS_MAX_LEN) {
    throw new Error(`location.address must be at most ${ADDRESS_MAX_LEN} characters`);
  }

  const city = (input.city != null ? String(input.city) : '').trim().slice(0, 200);
  const state = (input.state != null ? String(input.state) : '').trim().slice(0, 200);
  const postalCode = (input.postalCode != null ? String(input.postalCode) : '').trim().slice(0, 20);

  return {
    lat,
    lng,
    address: address || '',
    city: city || '',
    state: state || '',
    country,
    postalCode: postalCode || '',
  };
}

/**
 * Build location object from legacy addressJson (for migration/backfill).
 */
function locationFromAddressJson(addressJson) {
  if (!addressJson || typeof addressJson !== 'object') return null;
  const lat = addressJson.latitude ?? addressJson.lat;
  const lng = addressJson.longitude ?? addressJson.lng;
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return null;
  }
  return validateAndNormalizeLocation({
    lat: Number(lat),
    lng: Number(lng),
    address: addressJson.addressLine || addressJson.formattedAddress || '',
    city: addressJson.cityName || addressJson.city || '',
    state: addressJson.stateName || addressJson.state || '',
    country: addressJson.countryName || (addressJson.countryCode === 'BD' ? 'Bangladesh' : addressJson.countryCode || ''),
    postalCode: addressJson.postalCode || '',
  });
}

module.exports = { validateAndNormalizeLocation, locationFromAddressJson };
