# Frontend Location Integration – Universal Location Picker

**Reference:** [LOCATION_AUDIT.md](./LOCATION_AUDIT.md), [API_CONTRACTS.md](./API_CONTRACTS.md)

Where the **universal location picker** (search + map pin, Place output) should be used. Page routes and component placement only; no UI code.

---

## 1. User Location Selection

**Purpose:** Let the current user set or change “my location” (saved lat/lng + address) for defaults, prefills, or “use my location” in other flows.

| Area | Page route | Component placement | Note |
|------|------------|---------------------|------|
| **Owner profile** | `/owner/profile` | In profile form; one “Location” or “Default address” section. | Already uses `UnifiedLocationPicker`. Replace or wrap with universal picker; persist via `PUT /api/v1/me/location` and load via `GET /api/v1/me/location`. |
| **Owner register** | `/owner/register` | In registration form; single address field. | Currently plain text. Add universal picker (optional: “Use my location” from saved) or keep text + optional picker. |
| **General register** | `/register` | In sign-up form; address field. | Currently plain text. Add universal picker for consistency. |
| **App-level “My location”** | e.g. `/owner/settings` or header/sidebar | Optional: “Set my location” link or modal. | Single place to get/set user location; other pages can “use my location” (e.g. checkout, appointment). |

**Suggested component:** One shared **UniversalLocationPicker** (or reuse UnifiedEnhancedLocationPicker) used on profile and, if desired, in a dedicated “my location” screen or modal. Output: Place (lat/lng + optional address); frontend calls `PUT /api/v1/me/location` with that payload.

---

## 2. Owner / Org / Branch Creation

**Purpose:** Capture business address (and optional lat/lng) for organization and branch; keep existing validation (BD_AREA / DHAKA_AREA) where applicable.

| Area | Page route | Component placement | Note |
|------|------------|---------------------|------|
| **New organization** | `/owner/organizations/new` | Step 1 (basic info): “Business location” section. | Already uses `ImprovedLocationPicker`. Replace or wrap with universal picker; keep addressJson merge and bdAreaId/dhakaAreaId/countryCode for submit. |
| **Edit organization** | `/owner/organizations/[id]/edit` | Same section as new; “Business address” or “Location.” | Same as new; prefill from org addressJson + optional lat/lng. |
| **Org registration (wizard)** | `/owner/organizations/[id]/registration` | “Business location” step. | Already uses `UnifiedLocationPicker`. Use universal picker; output flows into addressJson. |
| **New branch** | `/owner/branches/new` | Inside branch form: “Branch address” or “Location.” | Form uses `BranchForm.jsx`, which uses `ImprovedLocationPicker`. Place universal picker in same slot; submit branch addressJson + optional branch profile lat/lng. |
| **Edit branch** | `/owner/branches/[id]/edit` or `/owner/organizations/[id]/branches/[branchId]/edit` | Same as new branch. | Prefill from branch addressJson and, when API supports it, BranchProfileDetails latitude/longitude. |
| **Branch profile / settings** | `/owner/branches/[id]/settings` | “Address & map” or “Location” section. | When branch profile API accepts lat/lng and coverageRadiusKm, add universal picker here; optional “service area” radius input beside it. |

**Suggested component:** Same **UniversalLocationPicker** as user location; same Place output. Owner/org/branch flows map Place to existing addressJson (and, for branch, to profile lat/lng when available). No removal of existing pickers until universal picker is the single implementation.

---

## 3. Shop Checkout

**Purpose:** Delivery or billing address at checkout (Place = lat/lng + address for “where to deliver”).

| Area | Page route | Component placement | Note |
|------|------------|---------------------|------|
| **Checkout (future)** | `/shop/checkout` or `/shop/cart/checkout` (TBD) | Checkout step: “Delivery address” or “Shipping address.” | Shop app is currently skeleton (“checkout later”). When checkout exists: one “Address” step with universal picker; optional “Use my location” from user location. |
| **Cart / order summary** | e.g. `/shop/cart` or inline in shop layout | Optional: “Delivery location” summary or edit link. | If cart shows delivery address before checkout, same picker or a read-only Place summary + “Change” opening picker. |

**Suggested component:** **UniversalLocationPicker** in checkout address step. Output: Place; frontend sends it to order/checkout API (e.g. shippingAddress or deliveryLocation). Optional: “Use my location” button that loads `GET /api/v1/me/location` and prefills picker.

---

## 4. Clinic Appointment

**Purpose:** Patient or clinic selects location for “where” the appointment applies (e.g. branch/clinic address, or patient address for home visit). Optional: “Find nearby clinics” using nearby-service API.

| Area | Page route | Component placement | Note |
|------|------------|---------------------|------|
| **Book appointment (future)** | e.g. `/clinic/book` or `/clinic/appointments/new` (TBD) | “Your location” or “Clinic / branch” selection. | Clinic app is skeleton (“bookings later”). When booking exists: either (a) pick “branch” from list (no picker), or (b) “Your location” with universal picker to find nearby branches. |
| **Clinic / branch selector** | Same or previous step | Optional: “Branches near me” list driven by `GET /api/v1/locations/nearby`; “Set my location” opens universal picker. | User sets location once; list shows branches within radius; user picks branch for appointment. |
| **Clinic home** | `/clinic` or `/clinic/services` | Optional: “Find clinics near you” with location input or “Use my location.” | Single picker or button; then show list from nearby API. |

**Suggested component:** **UniversalLocationPicker** for “your location” or “search area”; optional “Use my location.” Resulting Place (lat/lng) is passed to `GET /api/v1/locations/nearby` to show branches; user then selects a branch for the appointment. No UI code here; only placement.

---

## 5. Country Admin Settings

**Purpose:** Admin configures countries, states, and policies. Location picker is **not** used for policy rules (country/state are IDs or codes). Optional: display or filter by region; no “place” picker required for policy CRUD.

| Area | Page route | Component placement | Note |
|------|------------|---------------------|------|
| **Countries list** | `/admin/countries` | No picker. | Country list; no geo picker. |
| **Country detail / policies** | `/admin/countries/[id]/policies`, `/admin/countries/[id]/policies/[policyId]` | No picker. | Policy CRUD; country from route. |
| **Country features** | `/admin/countries/[id]/features` | No picker. | Feature toggles per country. |
| **Country users** | `/admin/countries/[id]/users` | No picker. | Staff per country. |
| **States** | `/admin/states`, `/admin/states/[id]/*` | Country dropdown (existing); no geo picker. | State CRUD; countryId/stateCode. |
| **Country dashboard (country staff)** | `/country/dashboard`, `/country/settings/*` | No picker. | Country staff view; country from session. |
| **Policy read (non-admin)** | N/A (e.g. header or meta) | No picker. | Frontend may call `GET /api/v1/meta/policy?countryCode=...`; countryCode from X-Country-Code or user/org context, not from a location picker. |

**Conclusion:** Country admin settings do **not** require the universal location picker. Country/state are selected via dropdowns or route params. Optional: if admin ever needs “default region” or “test location” as a Place, one could add the picker on a single settings page; not in scope for minimal list.

---

## 6. Summary Table

| Use case | Page route(s) | Component placement |
|----------|----------------|----------------------|
| User location selection | `/owner/profile`, `/owner/register`, `/register`, optional `/owner/settings` or global “my location” | Profile/register form; optional app-level “Set my location.” |
| Owner/org/branch creation | `/owner/organizations/new`, `/owner/organizations/[id]/edit`, `/owner/organizations/[id]/registration`, branch form (new/edit), `/owner/branches/[id]/settings` | “Business location” or “Branch address” section in each form. |
| Shop checkout | `/shop/checkout` (future) | “Delivery address” step. |
| Clinic appointment | `/clinic/book` or `/clinic/appointments/new` (future), optional `/clinic` | “Your location” or “Find nearby” step; optional “Use my location.” |
| Country admin settings | `/admin/countries/*`, `/admin/states/*`, `/country/*` | No universal picker; country/state via dropdown or context. |

---

## 7. Component Strategy (No Code)

- **Single universal picker:** One component (e.g. **UniversalLocationPicker**) used everywhere that needs a Place: search + map pin, output = { latitude, longitude, countryCode?, stateName?, cityName?, formattedAddress?, adminUnitIds? }.
- **Reuse path:** Prefer wrapping or replacing existing `UnifiedLocationPicker` / `UnifiedEnhancedLocationPicker` / `ImprovedLocationPicker` with this one so owner/org/branch flows stay consistent.
- **APIs:** User location: `GET /api/v1/me/location`, `PUT /api/v1/me/location`. Search: `GET /api/v1/locations/geocode`, `GET /api/v1/locations/search`. Reverse: `GET /api/v1/locations/reverse` or `POST /api/v1/locations/reverse-geocode`. Nearby: `GET /api/v1/locations/nearby` (for clinic/shop “near me”).
- **No UI code in this doc;** only page routes and placement.
