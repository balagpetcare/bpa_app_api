# Producer Governance Smoke Test

**Script:** `scripts/governance_smoke.ts`  
**Run:** `npm run smoke:governance` (requires env `ADMIN_TOKEN` and `ORG_ID`)

## What it does

The script calls all governance endpoints and validates envelope shape and non-empty `traceId`:

1. `GET /api/v1/admin/producers`
2. `GET /api/v1/admin/producers/:orgId`
3. `GET /api/v1/admin/producers/:orgId/metrics`
4. `GET /api/v1/admin/producers/:orgId/audit?fromDate=&toDate=`
5. `GET /api/v1/admin/producers/:orgId/print-jobs?fromDate=&toDate=`
6. `GET /api/v1/admin/approvals?producerOrgId=:orgId`
7. `GET /api/v1/admin/permissions`

Validation: `success` (boolean), `traceId` (present and non-empty). Exit code 0 if all pass, 1 otherwise.

## Env vars (required)

| Var | Description | Default |
|-----|-------------|--------|
| `BASE_URL` | API base URL (no path) | `http://localhost:3000` |
| `ADMIN_TOKEN` | **Required.** Bearer token for admin auth | — |
| `ORG_ID` | **Required.** Producer org ID (positive integer) for org-scoped calls | — |

If `ADMIN_TOKEN` or `ORG_ID` is missing, the script exits with code 1 and a clear message.

## How to run smoke tests (exact commands)

**Local (API on localhost:3000):**
```bash
cd backend-api
ADMIN_TOKEN=your_admin_jwt ORG_ID=1 npm run smoke:governance
```

**Against a deployed API:**
```bash
BASE_URL=https://api.example.com ADMIN_TOKEN=your_admin_jwt ORG_ID=42 npm run smoke:governance
```

**Using npx directly:**
```bash
npx ts-node scripts/governance_smoke.ts
```
(Still requires `ADMIN_TOKEN` and `ORG_ID` in the environment.)

## CI

- Run after deploy. Set `BASE_URL` to the deployed API, `ADMIN_TOKEN` to a test admin Bearer token, `ORG_ID` to a valid producer org id.
- Node 18+ required (uses global `fetch`).
