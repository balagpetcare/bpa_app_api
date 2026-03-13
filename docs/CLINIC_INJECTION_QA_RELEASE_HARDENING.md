# BPA Clinic Injection Tokens + Injection Room — QA + Release Hardening

**Date:** 2026-03-14.  
**Mode:** Bug-fix only; no new features, no architecture change, no schema change.

---

## 1. Changed files

| File | Change |
|------|--------|
| `bpa_web/app/.../injection-tokens/page.tsx` | **Pagination clamp:** After list load, if `total` implies current `page` is past the last page (e.g. filter reduced total, or stale page from prior filter), reset `page` to 0 via `setPage(prev => ...)` to avoid empty list + "Page N of 1". |
| `docs/CLINIC_INJECTION_QA_RELEASE_HARDENING.md` | **New.** This handoff. |

**Backend:** No changes.  
**injection-room:** No code changes (audited; null-safe handling and refetch already in place).

---

## 2. Bugs fixed

| Bug | Fix |
|-----|-----|
| **Pagination stale page** | When `load()` completed with a `total` that made the current `page` invalid (e.g. on page 2, total later became 15 so only one page), the list showed empty and pagination showed "Page 2 of 1". Now, after `setTotal(newTotal)`, we call `setPage(prev => (newTotal > 0 && prev >= Math.ceil(newTotal / pageSize) ? 0 : prev))` so the page is clamped to a valid range. |

No other runtime or integration bugs were found in the audited flows (generate, validate, re-validate, cancel, normal dose, bypass dose, room mismatch, board tabs/filters, unassigned + room, drawer, pagination, permissions, optional data). Null handling, filter interaction, and refetch (e.g. `loadBoard()` after dose) were already correct or had been addressed in final stabilization.

---

## 3. Remaining non-blocking issues

- **Board load failure:** On board API error we show "Unable to load board" with no Retry button; user can refresh or change filter to refetch. Consider adding a Retry in a future iteration; not required for release.
- **Per-operator / room workload summaries:** Not implemented; optional enhancements.
- **Token list room column:** Not added; list kept lean by design.

None of these block internal testing or pilot rollout.

---

## 4. Final QA checklist result

| Area | Result |
|------|--------|
| Generate token (visit search, Rx/course/day/vial) | OK — code path and API alignment verified. |
| First validate vs re-validate | OK — backend and UI handle alreadyValidated; no duplicate audit. |
| Cancel with/without reason | OK — modal and body.reason; backend persists. |
| Normal dose record | OK — payload and refetch correct. |
| Bypass dose with reason | OK — reason required and sent; loadBoard after submit. |
| Room mismatch UI + backend | OK — Step 3 warning; backend ROOM_MISMATCH; toast message. |
| Pending/Completed/Bypass/Expired/Unassigned tabs | OK — all use `?? []` where needed. |
| Generated / Validated / Administered by me filters | OK — params passed; backend filters applied. |
| Unassigned + room filter | OK — unassignedTokens and room filter behaviour correct. |
| Token drawer lifecycle | OK — audit uses context then list row; visit link guarded. |
| Pagination + filters | OK — page resets on filter change; page clamped when total shrinks (fix applied). |
| Permissions / forbidden states | OK — PERMS and canCancel/canBypass gate UI; AccessDenied when !hasAccess. |
| Missing optional data / null-safe handling | OK — optional chaining and fallbacks in place; no raw JSON in UI. |
| Dead code | OK — no unused imports or duplicate logic identified in scope. |

---

## 5. Final release readiness status

| Criterion | Status |
|----------|--------|
| **Ready for internal testing** | **Yes.** All audited flows and filters behave correctly; pagination edge case fixed. |
| **Ready for pilot branch rollout** | **Yes.** No blockers; no schema or architecture change; changes are minimal and production-safe. |
| **Not ready** | **N/A.** No blocker found. |

---

**End of QA + release hardening pass.**
