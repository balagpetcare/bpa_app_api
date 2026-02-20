/**
 * Geo controller - static countries/states + Nominatim proxy.
 * No DB dependency for countries/states.
 */

const axios = require('axios');
const { GEO_COUNTRIES, GEO_STATES_BY_COUNTRY, GEO_CITIES_BY_COUNTRY_STATE } = require('./geo.data');

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min in-memory
const geocodeCache = new Map<string, { data: unknown; timestamp: number }>();

function getCacheKey(type: string, key: string): string {
  return `geo:${type}:${key}`;
}

function getCached<T>(key: string): T | null {
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    geocodeCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown): void {
  geocodeCache.set(key, { data, timestamp: Date.now() });
}

export function listCountries(_req: unknown, res: any): void {
  try {
    res.json({ success: true, data: GEO_COUNTRIES });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
}

export function listStates(req: any, res: any): void {
  try {
    const country = String(req.query?.country || '').toUpperCase().trim().slice(0, 2);
    if (!country) {
      return res.json({ success: true, data: [] });
    }
    const states = GEO_STATES_BY_COUNTRY[country] || [];
    res.json({ success: true, data: states });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
}

export function listCities(req: any, res: any): void {
  try {
    const country = String(req.query?.country || '').toUpperCase().trim().slice(0, 2);
    const state = String(req.query?.state || '').trim();
    if (!country || !state) {
      return res.json({ success: true, data: [] });
    }
    const stateCode = (GEO_STATES_BY_COUNTRY[country] || []).find(
      (s: { code: string; name: string }) =>
        s.code.toUpperCase() === state.toUpperCase() ||
        s.name.toLowerCase() === state.toLowerCase()
    )?.code || state.slice(0, 10);
    const key = `${country}:${stateCode}`;
    const cities = GEO_CITIES_BY_COUNTRY_STATE[key] || [];
    res.json({ success: true, data: cities });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || 'Server error' });
  }
}

export async function searchGeo(req: any, res: any): Promise<void> {
  try {
    const q = String(req.query?.q || '').trim();
    const country = String(req.query?.country || '').trim().slice(0, 2).toLowerCase();

    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const cacheKey = getCacheKey('search', `${country}:${q.toLowerCase()}`);
    const cached = getCached<unknown[]>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const params: Record<string, string | number> = {
      q,
      format: 'json',
      limit: 10,
      addressdetails: 1,
    };
    if (country) params.countrycodes = country;

    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params,
      headers: { 'User-Agent': 'BPA-Location-System/1.0' },
      timeout: 10000,
    });

    const results = (response.data || []).map((item: any) => ({
      place_id: item.place_id ?? null,
      osm_id: item.osm_id ?? null,
      osm_type: item.osm_type ?? null,
      display_name: item.display_name,
      name: item.name,
      lat: item.lat,
      lon: item.lon,
      type: item.type,
      class: item.class,
      address: item.address || {},
    }));

    setCache(cacheKey, results);
    res.json({ success: true, data: results });
  } catch (e: any) {
    console.error('Geo search error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Geocoding error' });
  }
}

export async function reverseGeo(req: any, res: any): Promise<void> {
  try {
    const lat = parseFloat(req.query?.lat);
    const lng = parseFloat(req.query?.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ success: false, message: 'lat and lng are required' });
    }

    const cacheKey = getCacheKey('reverse', `${lat.toFixed(4)},${lng.toFixed(4)}`);
    const cached = getCached<unknown>(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached });
    }

    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon: lng, format: 'json', addressdetails: 1 },
      headers: { 'User-Agent': 'BPA-Location-System/1.0' },
      timeout: 10000,
    });

    const result = {
      display_name: response.data.display_name || '',
      name: response.data.name || '',
      lat: response.data.lat,
      lon: response.data.lon,
      address: response.data.address || {},
    };

    setCache(cacheKey, result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    console.error('Reverse geocode error:', e);
    res.status(500).json({ success: false, message: e?.message || 'Reverse geocoding error' });
  }
}
