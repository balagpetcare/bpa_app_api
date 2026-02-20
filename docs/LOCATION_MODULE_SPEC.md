# Location Module Spec - Custom Map & Drag-and-Drop Picker (No Google)

**BPA Standard - Production-ready plan**

*(Aligned with [BPA_STANDARD.md](../BPA_STANDARD.md), [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md), [GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md](./GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md) section 4 and 12.2.)*

---

## 1. Purpose

সারা বিশ্বের জন্য **কাস্টম ম্যাপ** (Google ছাড়া) + **Drag & Drop location picker** বানানো। মূল ধারণা:

- **Map rendering:** ফ্রি ওপেন-সোর্স লাইব্রেরি
- **Map data/tiles:** OpenStreetMap বা নিজের টাইল সার্ভার
- **Search + Address (optional):** OSM-ভিত্তিক geocoder (Nominatim/Photon); চাইলে নিজে হোস্ট

---

## 2. কাস্টম ম্যাপ মানে কী?

৩টা জিনিস কাস্টমাইজ করা যাবে:

1. **ম্যাপ স্টাইল/লুক** - রং, রোড স্টাইল, লেবেল ইত্যাদি
2. **ম্যাপ টাইল সোর্স** - OSM / নিজের টাইল / CDN
3. **লোকেশন পিকার UI** - center pin / draggable marker / confirm button

ইউজারের কাছে দেখাবে আমাদের নিজস্ব ম্যাপ; ভিতরে থাকবে ওপেন ডাটা + ওপেন লাইব্রেরি।

---

## 3. Recommended stack (Google ছাড়া, global coverage)

### Option A - সবচেয়ে সহজ + জনপ্রিয়

- **Leaflet.js** - ম্যাপ UI
- **OpenStreetMap raster tiles** - ম্যাপ টাইল

| Pros | Cons |
|------|------|
| খুব হালকা, মোবাইল-ফ্রেন্ডলি | অনেক বড় স্কেলে টাইল/সার্চ নিজের সার্ভারে নিতে হবে |
| Drag marker সহজ | |

### Option B - আধুনিক, smooth, vector

- **MapLibre GL JS** - ম্যাপ UI
- **Vector tiles + style.json** - কাস্টম স্টাইল

| Pros | Cons |
|------|------|
| সুন্দর UI/zoom, Google-like feel | ভেক্টর টাইল হোস্টিং/প্রোভাইডার সেটআপ লাগে |
| স্টাইল একদম কাস্টম করা যায় | |

**MapLibre দিয়ে draggable marker অফিসিয়াল example:** [Create a draggable Marker - MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/examples/create-a-draggable-marker/)

---

## 4. Location picker UI (Drag & Drop) - UX patterns

### Pattern-1: Center Pin (সবচেয়ে ইউজার-ফ্রেন্ডলি)

- ম্যাপ move করলে পিনটা মাঝখানে থাকে
- Confirm Location চাপলে center এর lat/lng নেওয়া হয়

**Pros:** ড্র্যাগ/প্যান সহজ; accidental marker drag কমে।

### Pattern-2: Draggable Marker

- Marker ধরে টেনে exact point সিলেক্ট
- Drag end এ lat/lng update

**Pros:** Familiar pattern; Leaflet ও MapLibre দুটোতেই সহজ।

---

## 5. Search + Address (optional)

### Low traffic (শুরুতে)

- Public **Nominatim** endpoint দিয়ে search + reverse geocode
- **সতর্কতা:** রেট-লিমিট থাকে; বড় স্কেলে ঠিক না

### Production (নিজের কন্ট্রোল)

- **Self-hosted Nominatim** (OSM geocoder)
- **Redis/DB cache** - একই এলাকায় বারবার reverse geocode না করা

---

## 6. খরচ কম রেখে সারা বিশ্বে চালানো

যেগুলোতে বেশি খরচ/হিট, সেগুলো নিজের কন্ট্রোলে আনা:

### A) Tiles (সবচেয়ে বেশি হিট)

- **শুরুতে:** OSM / সস্তা টাইল প্রোভাইডার
- **স্কেল হলে:** নিজস্ব tile cache/CDN অথবা নিজের tile server

### B) Reverse Geocode

- **ড্র্যাগ চলাকালীন reverse করবেন না**
- শুধু **Confirm** এ ১ বার
- **Cache** দিন (grid 50-100m)

### C) Data storage

DB-তে শুধু রাখবেন:

- `lat`, `lng`
- `formatted_address` (optional)
- `place_meta` (country, city, area - চাইলে)

---

## 7. BPA প্রোজেক্টে বাস্তবায়ন প্ল্যান

### MVP (Minimum)

1. Leaflet বা MapLibre map view
2. Center pin অথবা draggable marker
3. Confirm to save lat/lng

### Phase-2

4. Search box (Nominatim/Photon)
5. Reverse geocode on Confirm
6. Cache + rate limit + logging

### Phase-3 (Global scale)

7. Tile caching/CDN
8. Self-host geocoder
9. Monitoring (latency, errors, abuse)

---

## 8. API ও টেকনিক্যাল স্পেক (ব্লুপ্রিন্ট 12.2 অনুযায়ী)

### Address search

- **Provider:** Nominatim / Photon
- **Request/response shape:** query string to list of `{ lat, lng, display_name, place_id?, boundingbox? }`
- **Rate limit:** per IP / per user; configurable (e.g. 1 req/sec for public Nominatim)

### Pin drop + reverse geocode

- **Trigger:** শুধু Confirm এ; ড্র্যাগ চলাকালীন না
- **Input:** lat, lng
- **Output:** formatted_address, place_meta (country, city, area)
- **Cache:** Redis key e.g. `geocode:reverse:{rounded_lat}:{rounded_lng}` (grid 50-100m), TTL 24h-7d

### Caching strategy

- **Key:** e.g. `geocode:reverse:{lat_bucket}:{lng_bucket}` or hash of (lat, lng) with precision
- **TTL:** 24h-7d
- **Invalidation:** সাধারণত TTL দিয়েই; admin purge যদি দরকার হয়

### Fallback provider order

1. Primary: Nominatim (or self-hosted)
2. Fallback: Photon (বা অন্য OSM-compatible)
3. On failure: return lat/lng only, formatted_address null

### API endpoints (conceptual)

- `GET /api/v1/locations/geocode?q=...` - address search (forward)
- `GET /api/v1/locations/reverse?lat=...&lng=...` - reverse geocode (Confirm এ কল)
- Rate limit ও error codes: 429 RATE_LIMIT, 503 SERVICE_UNAVAILABLE

### Branch location + GeoFence

- Branch: `lat`, `lng`, `address_json`, `coverage_polygon` (GeoJSON optional)
- Validation: lat/lng range; polygon valid GeoJSON; optional max area

---

## 9. Related documentation

| Doc | Topic |
|-----|--------|
| [BPA_STANDARD.md](../BPA_STANDARD.md) | Ports, code change policy |
| [GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md](./GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md) | Location system (section 4), Next spec (section 12.2) |
| [MapLibre GL JS - Draggable Marker](https://maplibre.org/maplibre-gl-js/docs/examples/create-a-draggable-marker/) | Official example |
