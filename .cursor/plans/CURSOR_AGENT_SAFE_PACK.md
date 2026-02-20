# CURSOR_AGENT_SAFE_PACK.md

This file contains a **safe, low-token, error-minimized prompt pack** for running Cursor AI in Agent mode
for the BPA Owner Dashboard (port 3104).

---

## GLOBAL RULES (Paste at the top of every Agent task)

- Work only in the ACTIVE Next.js app directory (confirm `app/` vs `src/app/` first)
- DO NOT delete or rename existing working routes
- Use **alias / re-export pages only** (additive changes)
- Keep WowDash UI consistency (NO redesign)
- Keep API port **3000** and Owner panel **3104**
- Respect KYC gate logic; add exceptions if needed
- Max **6 files per task**
- Output:
  1. Files changed
  2. Exact diffs
  3. Manual acceptance steps
- STOP after each task

---

## PROMPT 0 — owner-gap-map (MANDATORY FIRST)

TODO: owner-gap-map
Goal: Identify active app directory and map IA routes to existing pages.

Steps:
1. Confirm active Next.js app dir
2. Map canonical IA routes → existing routes/files
3. Identify Access Requests list + detail pages
4. Identify Staff directory + Access control pages
5. List high-risk gates (KYC / layout guards)

Constraints:
- No code changes

Acceptance:
- Clear mapping table
- Active app directory confirmed

---

## PROMPT 1 — owner-route-aliases (Phase 1)

Goal:
Create canonical alias routes:
- /owner/access/requests
- /owner/access/requests/[requestId]

Rules:
- Alias only (re-export)
- Do not move old routes

Acceptance:
- Old routes work
- New routes work

---

## PROMPT 2 — Notification deep link

Goal:
Clicking notification of type STAFF_BRANCH_ACCESS_REQUEST opens:
/owner/access/requests/[requestId]

Acceptance:
- Badge count unchanged
- Correct deep link

---

## PROMPT 3 — Dashboard Pending Requests KPI

Goal:
Add KPI card + shortcut to /owner/access/requests

Acceptance:
- KPI visible
- Link works

---

## PROMPT 4 — Staff & Access canonical aliases

Goal:
- /owner/staff → alias existing staff list
- /owner/access/control → alias access control page

Acceptance:
- Canonical routes work
- Old routes untouched

---

## PROMPT 5 — Access Map (MVP)

Goal:
Add export-friendly staff × branch access table

Acceptance:
- Table loads
- Filters work

---

## PROMPT 6 — Branch list polish

Goal:
Filters + consistent StatusBadge mapping

Acceptance:
- Filters work
- Badges correct

---

## PROMPT 7 — Branch overview KPIs

Goal:
KPIs + quick links on branch detail page

Acceptance:
- KPIs visible
- Links work

---

## PROMPT 8 — Dashboard KPI alignment

Goal:
Ensure exactly 8 KPI cards per IA

Acceptance:
- 8 cards visible
- No slowdown

---

## PROMPT 9 — KYC Improvements

Goal:
Crop/preview stability, reject reason, resubmit flow

Acceptance:
- No crash
- Resubmission works

---

## PROMPT 10 — Permission normalize (HIGH RISK)

Goal:
Compatibility layer for singular/plural permission keys

Rules:
- Isolated patch
- No refactor

Acceptance:
- Sidebar items stable
- URL guard intact

---

## PROMPT 11 — Sidebar IA alignment

Goal:
Match IA sidebar groups using canonical routes

Acceptance:
- Sidebar loads
- No 404

---

## SAFETY SWITCHES (append to any prompt)

- If both app/ and src/app/ exist → STOP and ask
- If KYC redirect blocks new route → STOP and report
- If more than 6 files needed → STOP and split task

---

END OF FILE
