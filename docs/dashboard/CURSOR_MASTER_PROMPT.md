# CURSOR_MASTER_PROMPT.md
> Copy-paste this whole prompt into Cursor/Trae.
> Goal: Implement Branch Dashboard in Staff App (Port 3100) using the docs in this zip.

---

## System Context (Must follow)
- Keep API port `3000` unchanged.
- Keep staff app port `3100` unchanged.
- Do not delete existing code. Only add/merge.
- Follow WowDash UI style (cards, tables, tabs, badges).
- Permission-based UI AND server authorization are mandatory.

---

## You (the coding agent) must do the following
### 1) Read docs in this order
1. `BRANCH_DASHBOARD_BUILD_PLAN.md`
2. `BRANCH_PERMISSION_MATRIX.md`
3. `BRANCH_SIDEBAR_CONFIG.md`
4. `BRANCH_API_MAP.md`
1. `BRANCH_DASHBOARD_BUILD_PLAN_first.md`

### 2) Implement in small PR-sized steps
Implement step-by-step, committing after each step:
1. Add `/staff/branch` selector page (pending polling every 10s)
2. Add `/staff/branch/[branchId]` overview skeleton + layout
3. Create `useBranchContext(branchId)` hook + caching
4. Add `PermissionGate` wrapper + AccessDenied page
5. Build Overview widgets (KPIs, TodayBoard, Alerts, Activity)
6. Add Inventory pages (summary/receive/adjustments/transfers)
7. Add POS pages
8. Add Clinic services page (feature flag by branch.type)
9. Add Staff/Shifts (manager permission)
10. Add Reports (permission-limited)
11. Add optional slug redirect route

### 3) Quality rules
- No unauthorized data leakage: forbidden access returns 403 and shows AccessDenied UI.
- Handle 401 -> redirect to login flow.
- Clean loading/empty/error states.
- All links are branch-scoped.

---

## Required Output
After implementation, produce:
1) A short file `docs/BRANCH_DASHBOARD_IMPLEMENTATION_NOTES.md` containing:
- what you changed
- new routes
- new components
- any API endpoints assumed/mapped
2) Ensure app builds and routes load without runtime errors.

---

## Start Now
First: search the repo for existing staff branch routes and existing API wrappers.
Then implement Step 1: `/staff/branch` selector with polling.
