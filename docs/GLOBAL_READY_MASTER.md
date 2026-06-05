# Global-Ready Master – BPA / WorldPetsAssociation

**Purpose:** Single source of truth for the Global-Ready (Country-First) platform: philosophy, rules, and launch checklist.

*(Aligned with [BPA_STANDARD.md](../BPA_STANDARD.md), [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md).)*

---

## 1. Philosophy

- **Country-First:** Every request has a country context (header, subdomain, or default). Policy, features, and compliance are per country.
- **Additive Only:** New countries and policies do not break existing flows. Default country = BD when no context.
- **Policy as Data:** Feature flags (DONATION, ADS, PRODUCTS), donation rules, payment methods, and ads rules live in DB; no code deploy to turn features on/off per country.
- **Scope + Action:** RBAC uses (Scope: Global / Country / Org / Branch) + Action for menu and API.

---

## 2. Rules (DO / DON'T)

| DO | DON'T |
|----|--------|
| Send `X-Country-Code` from web/app for all API calls | Change fixed ports (API 3000; bpa_web 3100–3107; bpa-landing 3101; vaccination_2026 3110 — see [infrastructure/PORT_AND_DOMAIN_MAP.md](./infrastructure/PORT_AND_DOMAIN_MAP.md)) |
| Resolve country: header → user/org → default BD | Redesign UI; follow WowDash patterns |
| Gate donation/ads UI by policy features | Overwrite existing code without merging |
| Use policy engine cache (e.g. Redis) for active policy | Add new country without policy seed |
| Apply migrations and seed in order (Phase 1 → 6) | Deploy without running migrations |

---

## 3. Key Docs

| Doc | Topic |
|-----|--------|
| [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md) | Phases 1–6, touch points |
| [GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md](./GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md) | 3-layer, URL, RBAC, rollout |
| [GLOBAL_READY_PRODUCT_SYSTEM.md](./GLOBAL_READY_PRODUCT_SYSTEM.md) | GPR, serialization, supply chain |
| [COUNTRY_POLICY_ENGINE_DESIGN.md](./COUNTRY_POLICY_ENGINE_DESIGN.md) | Policy tables, runtime, cache |
| [AML_KYC_FLOW.md](./AML_KYC_FLOW.md) | Donation/KYC status, admin review |
| [MVP_GLOBAL_LAUNCH_CHECKLIST.md](./MVP_GLOBAL_LAUNCH_CHECKLIST.md) | Pre-launch checklist |
| [DEVELOPER_ONBOARDING_GLOBAL.md](./DEVELOPER_ONBOARDING_GLOBAL.md) | Env, DoD, error standard |

---

## 4. Phase Apply Docs (order)

1. [GLOBAL_READY_PHASE1_APPLY.md](./GLOBAL_READY_PHASE1_APPLY.md) – Country + Policy + Context
2. [GLOBAL_READY_PHASE2_APPLY.md](./GLOBAL_READY_PHASE2_APPLY.md) – Donation + Compliance
3. [GLOBAL_READY_PHASE3_APPLY.md](./GLOBAL_READY_PHASE3_APPLY.md) – Storage + Payment + Location
4. [GLOBAL_READY_PHASE4_APPLY.md](./GLOBAL_READY_PHASE4_APPLY.md) – Ads + Govt Reporting + RBAC
5. Phase 5 – Frontend + App (X-Country-Code, country picker, policy UI)
6. Phase 6 – Docs + Launch Prep (this doc set)

---

## 5. New Country Rollout Checklist

1. Add country row (e.g. IN, US) in `countries` table (or run seed).
2. Create ACTIVE `country_policies` row with `policy_features`, `policy_donation_rules`, `policy_payment_methods`, `policy_ads_rules` as needed.
3. Seed default OFF for DONATION/ADS for new country unless explicitly enabled.
4. Configure payment methods and donation limits per local rules.
5. Run `npx prisma db seed` if seeders include new country.
6. Invalidate policy cache: Redis `DEL policy:XX:active` or restart API.
7. Verify: call API with `X-Country-Code: XX`, check `GET /api/v1/meta/features?countryCode=XX` and donation/ads flows.
8. Monitor audit logs and govt reporting hook after go-live.
