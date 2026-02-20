# Role & Permission Matrix (Scope + Action)

Purpose: define Global and Country roles and the permission naming standard.

## 1) Permission naming standard

- `SCOPE_RESOURCE_ACTION`
- Scope: GLOBAL, COUNTRY, ORG, BRANCH
- Resource examples: COUNTRY, POLICY, FEATURE, USER, ORG, BRANCH, DONATION

## 2) Global roles (examples)

| Role | Permissions (examples) |
| --- | --- |
| SUPER_ADMIN | GLOBAL_COUNTRY_*, GLOBAL_POLICY_*, GLOBAL_AUDIT_VIEW |
| COMPLIANCE_ADMIN | GLOBAL_POLICY_VIEW, GLOBAL_AUDIT_VIEW |
| PLATFORM_FINANCE | GLOBAL_DONATION_VIEW, GLOBAL_REPORT_EXPORT |

## 3) Country roles (examples)

| Role | Permissions (examples) |
| --- | --- |
| COUNTRY_ADMIN | COUNTRY_FEATURE_UPDATE, COUNTRY_POLICY_UPDATE, COUNTRY_USER_MANAGE |
| COUNTRY_COMPLIANCE | COUNTRY_DONATION_REVIEW, COUNTRY_REPORT_EXPORT |
| COUNTRY_SUPPORT | COUNTRY_USER_VIEW, COUNTRY_ORG_VIEW |
| COUNTRY_CONTENT_MOD | COUNTRY_ADS_REVIEW, COUNTRY_REPORT_VIEW |

## 4) Org/Branch roles (existing)

| Role | Scope |
| --- | --- |
| ORG_OWNER | Org |
| BRANCH_MANAGER | Branch |
| STAFF | Branch |
| VET | Branch |
| SELLER | Branch |

## 5) Required checks per request

1. Authentication
2. Country context
3. Scope + action permission
4. Feature gate (if country-toggled)
5. Policy guard (if rules required)

