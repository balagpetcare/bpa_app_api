# Root Cause Analysis: Admin Shows ACTIVE `uat-paid-2026`, Booking Shows “Campaign not found”

**Date:** 2026-06-04  
**Scope:** Analysis only — no code changes  
**Projects:** `backend-api`, `vaccination_2026`

---

## Executive summary

The booking site does **not** load the campaign you see as ACTIVE in admin (`uat-paid-2026`). It loads whatever is in **`NEXT_PUBLIC_CAMPAIGN_SLUG`**, which is set to **`uat-free-2026`** in `vaccination_2026/.env.local`.

Live API checks against a running backend (`localhost:3000`) show:

| Slug | HTTP | `error.message` |
|------|------|-----------------|
| `uat-free-2026` (env default) | **404** | **`Campaign not found`** |
| `uat-paid-2026` (admin ACTIVE) | **200** | — (success, `status: ACTIVE`, `visibility: PUBLIC`) |
| `does-not-exist-slug` | 404 | `Campaign with ID 0 not found` |

So the user-visible message **`Campaign not found`** is produced by the **public slug handler’s visibility/status gate**, not by a missing DB row and **not** by `CampaignConfig`.

---

## A. Which slug the booking page requests

| Source | File | Line | Resolved slug |
|--------|------|------|----------------|
| Booking wizard | `vaccination_2026/components/booking/BookingWizard.tsx` | **28** | `process.env.NEXT_PUBLIC_CAMPAIGN_SLUG \|\| "uat-free-2026"` |
| Used in fetch | `BookingWizard.tsx` | **90** | `fetchCampaignBySlug(SLUG)` |
| Local env | `vaccination_2026/.env.local` | **3** | `NEXT_PUBLIC_CAMPAIGN_SLUG=uat-free-2026` |
| Example env | `vaccination_2026/.env.example` | **13** | `cat-flu-rabies-2026` (different again) |

**Conclusion (A):** `/book` requests slug **`uat-free-2026`**, not **`uat-paid-2026`**.

The wizard does **not** read the campaign passed to the landing page or any “active campaign” API. `/book` is hard-wired to the env slug only.

---

## B. Which API endpoint is called

| Step | Client | Endpoint |
|------|--------|----------|
| 1 | `fetchCampaignBySlug` | `GET /api/v1/campaign/public/campaigns/{slug}` |
| Client definition | `vaccination_2026/lib/campaignApi.ts` | **129–131** (`pub = "/api/v1/campaign/public"`) |
| Proxy | `vaccination_2026/next.config.js` | **14–24** — `/api/*` → `API_BASE_URL` (default `http://localhost:3000`) |
| Route | `backend-api/src/api/v1/modules/campaign/campaign.routes.ts` | **174** |
| Handler | `backend-api/src/api/v1/modules/campaign/campaign.controller.ts` | **57–91** (`getPublicCampaignBySlugHandler`) |

Related calls on the same page (after campaign load): `fetchLocationSlots`, `initCheckout` — these never run if step 1 fails because `campaign` stays `null`.

Landing/countdown (same slug source):

| Component | File | Line |
|-----------|------|------|
| `CampaignBookingProvider` | `vaccination_2026/components/landing/CampaignBookingContext.tsx` | **7, 21, 29** — `fetchCampaignCountdown(slug)` → `GET .../campaigns/:slug/countdown` |

Home page (`/`) uses the same env slug at `vaccination_2026/app/page.tsx` **11, 116** but **falls back** to `fetchCampaignList()` on error (**118–122**). **`/book` has no such fallback.**

---

## C. API response (verified)

### Requested slug: `uat-free-2026` (booking env)

```http
GET /api/v1/campaign/public/campaigns/uat-free-2026
```

**Response (observed):**

```json
{
  "success": false,
  "error": {
    "code": "CAMPAIGN_NOT_FOUND",
    "message": "Campaign not found"
  }
}
```

**HTTP status:** 404

### Admin’s slug: `uat-paid-2026`

```http
GET /api/v1/campaign/public/campaigns/uat-paid-2026
```

**Response (observed):** `success: true`, `data.status: "ACTIVE"`, `data.visibility: "PUBLIC"`, `data.config.bookingEnabled: true`, etc.

### Missing slug (control)

```http
GET /api/v1/campaign/public/campaigns/does-not-exist-slug
```

**Response:** `message: "Campaign with ID 0 not found"` — thrown from `getCampaignBySlug` when no row exists (`campaign.service.ts` **146–147**).

**Conclusion (C):** The exact text **“Campaign not found”** only matches the **controller gate** (see D). `uat-free-2026` **exists in the database** but is **rejected for public booking**, not absent.

---

## D. Why ACTIVE campaign in admin is “rejected” on the booking page

### Failure is not “admin ACTIVE vs public inactive” for the same slug

Admin list shows **`uat-paid-2026`** as ACTIVE. The booking app never calls that slug unless env is changed.

### Failing condition (public API)

After `getCampaignBySlug(slug)` loads a row, the handler applies:

```67:71:backend-api/src/api/v1/modules/campaign/campaign.controller.ts
    if (campaign.visibility !== "PUBLIC" || campaign.status !== "ACTIVE") {
      return res.status(404).json({
        success: false,
        error: { code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found" },
      });
```

**Exact failing condition:**  
`campaign.visibility !== "PUBLIC"` **OR** `campaign.status !== "ACTIVE"`  
(both must pass; either failure returns the same 404 body).

For **`uat-free-2026`**, this gate fails (message = `Campaign not found`).  
For **`uat-paid-2026`**, both pass (200).

### Loader before the gate

```127:150:backend-api/src/api/v1/modules/campaign/campaign.service.ts
export async function getCampaignBySlug(slug: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    ...
  });

  if (!campaign) {
    throw CampaignErrors.NOT_FOUND(0);
  }

  return campaign;
}
```

If the slug were missing, the client would see **`Campaign with ID 0 not found`**, not **`Campaign not found`**.

### Admin vs public rules

| Surface | Status filter | Visibility filter |
|---------|---------------|-------------------|
| Admin list | Optional (`status` query) | **No** — lists DRAFT/PAUSED/UNLISTED too |
| Public `GET /campaigns/:slug` | **Must be `ACTIVE`** | **Must be `PUBLIC`** |

So admin can show **ACTIVE** on a campaign that is **`UNLISTED` / `PRIVATE`** or show a **different slug** than the site env.

### Booking UI behavior

```89:92:vaccination_2026/components/booking/BookingWizard.tsx
  useEffect(() => {
    fetchCampaignBySlug(SLUG)
      .then(setCampaign)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load campaign"));
```

```248:248:vaccination_2026/components/booking/BookingWizard.tsx
            {error && step !== 5 ? <div className="alert alert-danger py-2">{error}</div> : null}
```

```16:27:vaccination_2026/lib/api.ts
async function parseError(res: Response): Promise<never> {
  ...
    if (j?.error?.message) msg = j.error.message;
```

**User sees:** alert with **`Campaign not found`** (API `error.message`).

**Conclusion (D):** The ACTIVE campaign in admin (`uat-paid-2026`) is not rejected — it is **never requested**. The env slug (`uat-free-2026`) is rejected by the **PUBLIC + ACTIVE** gate (and/or is the wrong campaign entirely).

---

## E. Whether `CampaignConfig` dependency is failing

**No — not for this symptom.**

Config is loaded **only after** the visibility/status gate succeeds:

```74:88:backend-api/src/api/v1/modules/campaign/campaign.controller.ts
    const configRow = await getCampaignConfigOrNull(campaign.id);
    const config = configRow
      ? { bookingEnabled: ..., onlinePaymentEnabled: ..., ... }
      : null;

    res.json({ success: true, data: { ...campaign, config } });
```

`getCampaignConfigOrNull` (`config.service.ts` **90–92**) returns `null` if no row; the handler still returns **200** with `config: null`.

For **`uat-paid-2026`**, a config row is present (`bookingEnabled: true`, etc.).

For **`uat-free-2026`**, the request **never reaches** config lookup because the handler returns 404 at line **67–71**.

Checkout `initCheckout` uses `getCampaignConfigOrNull` separately (`checkout.service.ts`) — irrelevant until the wizard loads campaign metadata.

---

## F. Whether the booking page expects a different slug

**Yes.**

| Expectation | Actual |
|-------------|--------|
| Operator expects site to track admin’s ACTIVE campaign | Admin: **`uat-paid-2026`** |
| Site is configured for | **`uat-free-2026`** (`.env.local` line 3) |
| Fallback default in code | **`uat-free-2026`** (`BookingWizard.tsx` line 28) |

There is **no** “pick latest ACTIVE campaign” logic on `/book`. That pattern exists only in `rollout.service.ts` `resolveCampaignId` (**31–36**) for **checkout/backend** when slug omitted — not in the vaccination wizard loader.

`getPublicCampaigns()` (`campaign.service.ts` **223–230**) would return only **ACTIVE + PUBLIC + in date range** campaigns; home page can use `list[0]` as fallback, but **`BookingWizard` does not**.

---

## Investigation checklist (requested areas)

| # | Area | Finding |
|---|------|---------|
| 1 | Campaign loader | Client: `fetchCampaignBySlug` → public handler → `getCampaignBySlug` |
| 2 | Slug resolution | **Env-only** on frontend; no dynamic match to admin ACTIVE slug |
| 3 | Public campaign API | Gate at `campaign.controller.ts` **67–71** |
| 4 | Booking wizard init | `useEffect` line **89–92**; blocks UI until `campaign` set |
| 5 | CampaignConfig lookup | After gate; **not** cause of 404 for `uat-free-2026` |
| 6 | Active campaign selection | Admin: list all statuses; Public list: ACTIVE+PUBLIC+dates; **Book page: env slug only** |

---

## Duplicate / wrong-slug risk assessment

| Risk | Likelihood | Evidence |
|------|------------|----------|
| Env slug ≠ admin campaign slug | **Confirmed** | `uat-free-2026` vs `uat-paid-2026` |
| `uat-free-2026` not PUBLIC or not ACTIVE | **Confirmed** (gate path) | Same 404 message as gate, not “ID 0 not found” |
| Missing `CampaignConfig` | Ruled out | 404 occurs before config read |
| API proxy / wrong host | Unlikely | `uat-paid-2026` succeeds on same host |
| Second booking system | N/A | Single public campaign module |

---

## Suggested verification steps (no code)

1. Open `vaccination_2026/.env.local` — confirm `NEXT_PUBLIC_CAMPAIGN_SLUG`.
2. `GET /api/v1/campaign/public/campaigns/uat-free-2026` — expect 404 + `Campaign not found`.
3. `GET /api/v1/campaign/public/campaigns/uat-paid-2026` — expect 200.
4. In admin DB/UI, inspect **`uat-free-2026`** `status` and `visibility` (likely not both PUBLIC+ACTIVE).
5. Temporarily set env to `uat-paid-2026`, restart Next dev server, reload `/book`.

---

## Files reference (exact touch points)

| Role | Path |
|------|------|
| Env slug | `vaccination_2026/.env.local:3` |
| Wizard slug + fetch | `vaccination_2026/components/booking/BookingWizard.tsx:28,90,92,248` |
| API client | `vaccination_2026/lib/campaignApi.ts:129-131` |
| Error parsing | `vaccination_2026/lib/api.ts:16-27` |
| Public route | `backend-api/src/api/v1/modules/campaign/campaign.routes.ts:174` |
| **Failing condition** | `backend-api/src/api/v1/modules/campaign/campaign.controller.ts:67-71` |
| DB load by slug | `backend-api/src/api/v1/modules/campaign/campaign.service.ts:127-150` |
| Config (post-gate) | `backend-api/src/api/v1/modules/campaign/campaign.controller.ts:74-88` |
| Schema visibility enum | `backend-api/prisma/schema.prisma:13936` (`CampaignVisibility`) |

---

## Related docs

- `docs/campaign-v2/location-booking-implementation-report.md`
- `docs/campaign-v2/booking-flow-simplification-report.md`
