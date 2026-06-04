# Location Usage Matrix

**Scope:** `backend-api`, `bpa_web`, `bpa_app`  
**Date:** 2026-06-03  
**Recommended source:** `/api/v1/location-master` for BD hierarchy reads/writes; `/api/v1/geo` for non-BD dropdowns; `/api/v1/me/location` for user place/GPS.

---

## Backend modules

| Module | Current location source | Recommended source | Migration needed | Risk |
|--------|-------------------------|-------------------|------------------|------|
| Location master module | `src/modules/location` → `/location-master` | Same (canonical) | No | Low |
| Locations router (legacy) | `/api/v1/locations/*` (delegates to master for hierarchy) | Thin proxy → redirect clients to `/location-master` | Yes — deprecate duplicate paths | Medium — unknown external clients |
| Common BD API | `/api/v1/common/bd/*` direct Prisma | `/location-master` | Yes | Medium — Flutter legacy contract `{ items }` |
| Geo module | `/api/v1/geo` + `geo.data.ts` static | Keep for non-BD; optional DB-backed countries later | Optional | Low |
| Me location | `/api/v1/me/location` (`LocationPlace`) | Keep; link `place` rows to master IDs in payload | Yes — unify profile writes | Medium |
| User profile API | `addressJson` only; columns unused | `location-master` + `validateSelection` | Yes | High — web profile hub gap |
| Owner / org onboarding writes | `validateSelection` + `addressJson` | Same + drop legacy-only fields over time | Partial | Medium |
| Partner onboarding | Centralized validator | Same | No | Low |
| Producer / doctor verification | Centralized validator | Same | No | Low |
| Fundraising accounts | Partial FK + JSON | Full hierarchy + `unionId` if required | Yes | Medium |
| Campaign rollout regions | `/campaign/public/rollout/*` Prisma helpers | `/location-master` or shared service | Yes | Medium — admin UI separate from owner forms |
| Campaign locations (sites) | `campaign/location.service` | Keep separate domain model | No | Low — name collision only |
| Inventory locations | `InventoryLocation` warehouse rows | Keep; rename in docs/UI if confused | No | Low |
| Warehouse zone/link | `/warehouse/:id/locations/*` | Keep | No | Low |
| Dhaka service + routes | `locationDhaka.service` (unmounted) | `/locations/city-corporations` + `/areas` or master areas | Yes — delete or mount | Low (unused) |
| locations.service (legacy) | In-memory Dhaka tree `getDhakaLocations` | Master + corp/area endpoints | Yes | Low |
| Geocode / reverse | Nominatim via `/locations/geocode`, `/geo/reverse` | Consolidate on one module | Optional | Low |
| Seeds / scripts | `seedBaseBdLocations`, Dhaka seeders | Keep as data ops | No | Low |

---

## Web (Next.js) — components

| Module | Current location source | Recommended source | Migration needed | Risk |
|--------|-------------------------|-------------------|------------------|------|
| LocationField / LocationPickerUnified | `location-master` (BD) + `geo` (non-BD) | Same | No | Low |
| LocationSelector + *Dropdown | `locationMasterClient` | Same | No | Low |
| useRecentLocations | localStorage | Keep | No | Low |
| normalizeLocation / legacy fields | Dual IDs in JSON (`dhakaAreaId`, etc.) | Master IDs only in new APIs | Yes | High — persisted blobs |
| LocationPicker.jsx | `/locations/*` hierarchy | Remove or delegate to LocationField | Yes | Low — no app imports |
| LocationPicker.tsx (components/location) | `/geo` + static countries | LocationField | Yes | Low — no app imports |
| BdHierarchyPicker | `/locations/*` | Delete | Yes | Low — unused |
| Owner legacy pickers (`owner/_components/location/*`) | Mixed `/locations`, delegates | Delete after import audit | Yes | Low — mostly unreferenced |
| DhakaAreaPicker / DhakaCityAreaDropdown | `/locations/city-corporations`, `/areas` | Master areas typed filter OR keep corp endpoints | Yes | Medium if reintroduced |
| MapPicker (×3 variants) | `/locations/reverse` or `/geo/reverse` | Single MapPicker + one reverse endpoint | Optional | Low |
| lib/location/countries.ts | Static | `geo/countries` or shared package | Optional | Low |
| src/lib/locations.ts | Hardcoded demo tree | Delete | Yes | Low |
| lib/locationPlace.ts | `/me/location/manual` | Keep | No | Low |
| CountrySelect | Static countries file | `geo/countries` | Optional | Low |

---

## Web — application pages

| Module | Current location source | Recommended source | Migration needed | Risk |
|--------|-------------------------|-------------------|------------------|------|
| Org wizard / edit / registration | LocationField → location-master | Same | No | Low |
| BranchForm | LocationField | Same | No | Low |
| Owner KYC address | LocationField | Same | No | Low |
| Owner profile page | LocationField | Same + API must persist IDs | Yes (backend) | Medium |
| Org new page | `locationPlace` + `getMeLocation` | LocationField + me/location | Partial | Low |
| Owner onboarding (OrganizationStep, BranchStep) | Country text / address text only | LocationField | Yes | Medium |
| Admin campaign rollout | `campaignApi` rollout endpoints | location-master | Yes | Medium |
| Admin pre-registrations / demand | Campaign dashboards (IDs in rows) | Display labels from master | Optional | Low |
| Vendors new/edit | Free-text district/city | LocationField or structured fields | Yes | Medium |
| Inventory * pages | `/inventory/locations` warehouses | Keep; clarify labeling | No | Low |
| Account hub (doctor/owner/staff) | Profile API without LocationField | location-master + profile API | Yes | High |
| Producer / doctor apps (web) | No LocationField grep hits | Add if address forms exist | TBD | Low |

---

## Flutter — modules

| Module | Current location source | Recommended source | Migration needed | Risk |
|--------|-------------------------|-------------------|------------------|------|
| LocationRepository | `/location-master` | Same | No | Low |
| location_provider (*Providers) | location-master | Same | No | Low |
| LocationSelectorWidget | location_provider | Same | No | Low |
| location_picker_screen | location_provider | Same | No | Low |
| Fundraising create/edit/setup | LocationSelectorWidget | Same | No | Low |
| BdLocationsRepository | `/common/bd/*` | Deprecate | Yes | Low — **orphan** |
| bd_location_providers | common/bd | Remove with repository | Yes | Low — **orphan** |
| dhaka_location_providers | `/locations/dhaka` (404) | `/locations/city-corporations` + areas or drop | Yes | High if widget re-enabled |
| DhakaCityDropdowns | dhaka provider | Remove or fix endpoint | Yes | Low — **orphan** |
| api_endpoints bd* helpers | common/bd | Remove after repo delete | Yes | Low |
| Campaign / feed UI | Display strings | N/A | No | Low |

---

## API endpoint matrix (consumer → endpoint)

| Consumer | Endpoint(s) today | Status | Recommended |
|----------|-------------------|--------|-------------|
| Web LocationSelector | `GET /location-master/{divisions,districts,upazilas,unions}` | ACTIVE | Keep |
| Web LocationPickerUnified (non-BD) | `GET /geo/countries`, `/geo/states`, `/geo/search`, `/geo/reverse` | ACTIVE | Keep |
| Web MapPicker | `GET /locations/reverse` | ACTIVE | Prefer single reverse API |
| Web legacy LocationPicker.jsx | `GET /locations/divisions`…`bd-areas` | DEPRECATED | location-master |
| Web Dhaka pickers (dormant) | `GET /locations/city-corporations`, `/areas` | DEPRECATED UI | Master `areas` or corp routes |
| Flutter LocationRepository | `GET /location-master/*` | ACTIVE | Keep |
| Flutter BdLocationsRepository | `GET /common/bd/*` | ORPHAN | Delete |
| Flutter dhaka provider | `GET /locations/dhaka` | BROKEN | Fix or delete |
| Admin rollout UI | `GET /campaign/public/rollout/*` | ACTIVE | Align to location-master |
| Backend writes (org/branch) | `POST validate-selection` (internal) | ACTIVE | Keep |

---

## Duplicate summary

| Type | Instances | Action |
|------|-----------|--------|
| Backend BD read APIs | location-master, locations/*, common/bd, campaign/rollout | Collapse reads to location-master |
| Backend services | `modules/location`, `locations.service`, `common.controller` BD | Single service layer |
| Web pickers | 10+ files under `components/` and `owner/_components/location/` | Keep 1 chain (LocationField) |
| Web static lists | `locations.ts`, `countries.ts`, `lib/countries.ts` | One source (geo) |
| Flutter repos | `LocationRepository`, `BdLocationsRepository` | Keep one |
| Flutter providers | `location_*` vs `bd_*` vs `dhaka_*` | Keep `location_*` only |

---

## Risk heatmap (migration priority)

| Priority | Item | Reason |
|----------|------|--------|
| P0 | User profile / account hub not persisting master IDs | Data drift vs org/branch |
| P1 | Campaign admin rollout separate BD API | Inconsistent hierarchy with owner forms |
| P1 | `withLegacyLocationFields` / `addressJson` dual shapes | Write/read ambiguity |
| P2 | Remove orphan Flutter `common/bd` stack | Dead code but confusing |
| P2 | Delete/fix Flutter `/locations/dhaka` | Broken if used |
| P3 | Remove unmounted `locationDhaka.routes` | Dead code |
| P3 | Delete unused web picker files | Maintenance noise |
| P3 | Consolidate geocode/reverse endpoints | DX only |

---

*Use with `01-location-audit.md` for file paths and classification detail.*
