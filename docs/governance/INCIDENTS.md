# Governance incidents (Phase 4)

## Overview

Every enforcement action creates a **GovernanceIncident** record for audit and traceability. Incidents can be listed, filtered, and resolved via the admin API and Enforcement UI.

## Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/v1/admin/incidents` | `admin.governance.incidents.manage` | List incidents with filters |
| POST | `/api/v1/admin/incidents` | `admin.governance.incidents.manage` | Create incident (manual) |
| GET | `/api/v1/admin/incidents/:id` | `admin.governance.incidents.manage` | Get one incident |
| POST | `/api/v1/admin/incidents/:id/resolve` | `admin.governance.incidents.manage` | Resolve with optional note |

## List filters (all optional)

- `producerOrgId` – filter by producer org
- `entityType` – PRODUCT, BATCH, PRODUCER_ORG
- `entityId` – exact entity ID
- `incidentType` – e.g. POLICY_VIOLATION, HIDDEN, RESTORATION, FROZEN, SUSPENDED
- `severity` – LOW, MEDIUM, HIGH, CRITICAL
- `actionTaken` – e.g. HIDDEN, RESTORED, UNFROZEN, SUSPENDED
- `resolved` – true / false
- `dateFrom` / `dateTo` – filter by `createdAt` (ISO date)
- `q` – search in `reason` and `ticketId` (case-insensitive)
- `page`, `limit` – pagination (default limit 20, max 200)

## Enforcement actions that create incidents

| Action | Permission | incidentType / actionTaken | Response |
|--------|------------|----------------------------|----------|
| Product hide | `admin.governance.enforcement.hide` | HIDDEN | `{ ...product, incidentId }` |
| Product unhide | `admin.governance.enforcement.hide` | RESTORATION / RESTORED | `{ ...product, incidentId }` |
| Batch freeze | `admin.governance.enforcement.freeze` | FROZEN | `{ ...batch, incidentId }` |
| Batch unfreeze | `admin.governance.enforcement.freeze` | RESTORATION / UNFROZEN | `{ ...batch, incidentId }` |
| Producer suspend | `admin.governance.enforcement.suspend` | SUSPENDED | `{ ...org, incidentId }` |
| Producer unsuspend | `admin.governance.enforcement.suspend` | RESTORATION / UNSUSPENDED | `{ ...org, incidentId }` |

## Permissions

- **Incident list/create/get/resolve:** `admin.governance.incidents.manage`
- **Hide/unhide product:** `admin.governance.enforcement.hide`
- **Freeze/unfreeze batch:** `admin.governance.enforcement.freeze`
- **Suspend/unsuspend producer:** `admin.governance.enforcement.suspend`

## Safety

- No delete: incidents are only created and resolved (transition to resolved).
- Unhide: product status is restored to ACTIVE (or stored previous status if implemented).
- Unfreeze: allowed only if batch exists and user has `admin.governance.enforcement.freeze`.

## Model (GovernanceIncident)

- `id`, `entityType`, `entityId`, `producerOrgId`, `incidentType`, `severity`, `actionTaken`, `reason`, `ticketId`, `createdByUserId`, `resolvedAt`, `resolvedByUserId`, `resolutionNote`, `createdAt`, `updatedAt`
