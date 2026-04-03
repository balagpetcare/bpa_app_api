# Staff branch pharmacy dashboard — “Invalid id” on summary load

## 1. Problem summary

Opening **`/staff/branch/[branchId]/pharmacy`** triggers **`medicineRequisitionSummary`** → **`apiGet('/api/v1/medicine-requisitions/summary?...')`**. The client receives **HTTP 400** with **`message: "Invalid id"`**, which **`parseError`** turns into a thrown `Error`, surfacing in the console and toast.

## 2. Exact root cause

Backend **`medicine_requisitions.controller.getById`** returns **400 `"Invalid id"`** when:

```ts
const id = Number(req.params.id);
if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
```

For **`req.params.id === 'summary'`**, **`Number('summary')` is `NaN`**, and **`!NaN`** is **`true`**, so the handler returns **`Invalid id`**.

That means the request was handled by **`GET /:id`**, not by **`GET /summary`**, with **`id` literally the string `"summary"`**.

Why this happens (Express):

- **`router.get('/:id')`** matches **any** single path segment, including **`summary`**, unless a **more specific** static route wins first.
- In normal registration order (`/summary` before `/:id`), **`/summary`** should win. Any **ordering drift**, **duplicate routers**, **proxy path truncation** (e.g. backend sees `/medicine-requisitions/summary` as `/medicine-requisitions/:id` with `id=summary` in some edge case), or **stale build** can cause **`/:id`** to handle the segment **`summary`**.

**Defense in depth (correct fix):** restrict the param route to **numeric IDs only**:

- **`router.get('/:id(\\d+)', controller.getById)`** (and the same for **`PATCH` / `POST .../:id/...`**).

Then the segment **`summary`** **never** matches **`/:id(\\d+)`**; only **`router.get('/summary', ...)`** can satisfy **`/summary`**.

This aligns with the domain (requisition IDs are integers).

## 3. Correct API contract for requisition summary

| Item | Value |
|------|--------|
| Method / path | **`GET /api/v1/medicine-requisitions/summary`** |
| Query | Optional **`branchId`**, **`orgId`** (positive integers) — same scoping as list |
| Response | **`{ success: true, data: { total, pending, approved, dispatched } }`** |
| Must **not** use | **`GET /api/v1/medicine-requisitions/:id`** (detail) |

## 4. Param validation rules

- **`branchId`** (route): must be a **finite integer > 0** before calling summary/list.
- **`useParams().branchId`**: may be **`string | string[]`** (Next.js); normalize to a single string before **`Number()`**.
- **Query `branchId` / `orgId`**: only append if **`Number(x)`** is finite and **> 0**; never send **`NaN`**, **`undefined`**, or **`"undefined"`** as values.

## 5. Frontend fixes

- **`app/staff/(larkon)/branch/[branchId]/pharmacy/page.tsx`**: normalize **`branchId`**, validate, **skip** API calls (show empty/zero state) if invalid.
- **`lib/api.ts`**: **`medicineRequisitionSummary`** / **`medicineRequisitionList`** — only set **`branchId`/`orgId`** query params when validated as positive integers.

## 6. Backend fixes

- **`medicine_requisitions.routes.ts`**: replace bare **`/:id`** with **`/:id(\\d+)`** for all routes that refer to a numeric requisition id (including **`/:id/submit`**, etc.).

## 7. Edge cases

- Non-numeric legacy URLs like **`/medicine-requisitions/abc`** → **404** from no matching route (acceptable; previously **400 Invalid id**).
- **`/summary`** remains a dedicated static route; numeric constraint removes ambiguity.

## 8. Validation checklist

- [ ] `/staff/branch/1/pharmacy` loads with **no** console **`Invalid id`**.
- [ ] Network: **`GET .../medicine-requisitions/summary?branchId=1`** (or org-only where used) returns **200** with data or zeros.
- [ ] No **`.../medicine-requisitions/summary`** misrouted to detail.
- [ ] Detail **`GET .../medicine-requisitions/123`** still works.

## 9. Rollback / risk notes

- **Rollback:** revert **`medicine_requisitions.routes.ts`** param lines to **`/:id`** (not recommended; restores ambiguity).
- **Risk:** Any client calling **`/medicine-requisitions/001`** — **`\\d+`** matches; leading zeros OK. Non-numeric slugs for requisitions are rejected (by design).

---

## Status

**Implemented:** backend numeric `/:id(\\d+)` routes; `lib/api.ts` scope query validation; staff branch pharmacy dashboard `branchId` normalization + invalid-branch UI.

See **Changelog** in the task completion message for touched files.
