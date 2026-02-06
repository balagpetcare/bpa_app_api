# API Namespace Map (Country-First Gates)

Purpose: map API namespaces to required request gates.

Legend:
- Auth: authentication required
- RBAC: scope/action permission check
- Country: countryContext required
- Feature: requireFeature(FEATURE_CODE)
- Policy: policyGuard(policyKey,payload)
- Audit: audit log required

## 1) Global admin namespaces

| Namespace | Auth | RBAC | Country | Feature | Policy | Audit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/v1/global/countries` | Yes | GLOBAL_COUNTRY_* | No | No | No | Yes | Country CRUD |
| `/api/v1/global/policies` | Yes | GLOBAL_POLICY_* | No | No | No | Yes | Policy activation |

## 2) Country admin namespaces

| Namespace | Auth | RBAC | Country | Feature | Policy | Audit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/v1/country/me` | Yes | COUNTRY_* | Yes | No | No | No | Country dashboard |
| `/api/v1/country/features` | Yes | COUNTRY_FEATURE_* | Yes | No | No | Yes | Feature toggles |
| `/api/v1/country/policies` | Yes | COUNTRY_POLICY_* | Yes | No | No | Yes | Draft/update |
| `/api/v1/country/users` | Yes | COUNTRY_USER_* | Yes | No | No | Yes | Country staff |

## 3) Module namespaces (examples)

| Namespace | Auth | RBAC | Country | Feature | Policy | Audit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/v1/fundraising/*` | Yes | ORG_* | Yes | DONATION | donation.* | Yes | Money flows |
| `/api/v1/ads/*` | Yes | ORG_* | Yes | ADS | ads.* | Yes | Ads serve/create |
| `/api/v1/products/*` | Yes | ORG_* | Yes | PRODUCTS | No | Optional | Catalog |
| `/api/v1/orders/*` | Yes | ORG_* | Yes | ORDERS | No | Optional | Orders |
| `/api/v1/clinic/*` | Yes | ORG_* | Yes | CLINIC | No | Optional | Clinic |
| `/api/v1/adoptions/*` | Yes | ORG_* | Yes | ADOPTION | adoption.* | Yes | Adoption |

## 4) Public/meta namespaces

| Namespace | Auth | RBAC | Country | Feature | Policy | Audit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/v1/meta/features` | No | No | Optional | No | No | No | UI feature flags |

