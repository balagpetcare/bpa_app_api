# Governance Model (Global vs Country vs Org/Branch)

Purpose: clarify ownership, responsibilities, and decision boundaries.

## 1) Responsibility matrix

| Area | Global Admin | Country Admin | Org/Branch Admin |
| --- | --- | --- | --- |
| Country creation | Create / activate | View | - |
| Policy versioning | Approve / activate | Draft / propose | - |
| Feature toggles | Final approval | Request / update | - |
| Legal docs | Global baseline | Country-specific | Org-specific (if allowed) |
| Compliance rules | Define global minimum | Enforce locally | Follow |
| Roles & permissions | Define global roles | Assign country roles | Assign org/branch roles |
| Data access scope | All countries | Own country only | Own org/branch only |
| Audit & reporting | Global overview | Country overview | Org/branch overview |

## 2) Decision ownership

- Global admin owns:
  - Country onboarding and activation.
  - Global compliance baseline and cross-country policy standards.
  - Policy activation and rollback approval.
- Country admin owns:
  - Country-specific feature toggles (within global baseline).
  - Country staff management and local governance.
  - Country monitoring and compliance reporting.
- Org/Branch admin owns:
  - Operational data and daily workflows within their scope.

## 3) Conflict resolution

1. Global policy overrides country policy.
2. Country policy overrides org/branch configs.
3. State/province overrides country (future phase).

## 4) Audit requirements

- All policy changes must be recorded in audit logs.
- Role assignments and access changes must be logged.
- Country-specific reporting must be exportable.

