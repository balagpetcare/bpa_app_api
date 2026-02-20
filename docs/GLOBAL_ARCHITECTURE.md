# Global Architecture (Country-First)

Purpose: define the Global -> Country -> Org/Branch architecture and the
mandatory request gate for all modules. This document is additive and
compatible with existing BPA_STANDARD rules (ports, merge-only).

## 1) Layers

1. Global layer
   - Owns: countries, global policies, compliance baseline, global roles.
2. Country layer
   - Owns: country policy, feature toggles, country staff, legal configs.
3. Org/Branch layer
   - Owns: operational data (organizations, branches, services, orders, etc.)

## 2) Data scope rules

- Country scoped data must always be resolved via `req.countryContext`.
- Org/Branch data must be bound to a country (via organization binding).
- Cross-country access is denied by default (guard middleware).

## 3) Mandatory request gate (all endpoints)

```mermaid
sequenceDiagram
  participant Client
  participant API
  participant Auth
  participant CountryCtx
  participant RBAC
  participant Feature
  participant Policy
  participant Handler

  Client->>API: Request + X-Country-Code
  API->>Auth: authenticate
  API->>CountryCtx: resolve country context
  API->>RBAC: authorize(scope,action)
  API->>Feature: requireFeature(FEATURE_CODE)
  API->>Policy: policyGuard(policyKey,payload)
  API->>Handler: execute
```

## 4) Country resolution order

1. Header: `X-Country-Code`
2. Authenticated user country role
3. Organization country
4. Default `COUNTRY_DEFAULT` (BD)

## 5) Ports (fixed)

- API: 3000
- Next.js: 3100-3104

## 6) Additive-only policy

- No breaking changes to existing endpoints.
- All new features must be merge-only and backward compatible.

