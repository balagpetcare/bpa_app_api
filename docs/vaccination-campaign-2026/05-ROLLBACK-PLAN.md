# 05 — Rollback Plan

**Campaign:** BPA 2026 Cat Flu + Rabies Vaccination  
**Principle:** Roll back **forward deploys** without losing booked/vaccinated data.

---

## 1. Rollback triggers

Initiate rollback when any of the following occur during or immediately after deploy:

| Severity | Trigger | Example |
|----------|---------|---------|
| **Critical** | Complete booking or payment failure | 100% 500 on `POST /campaign/booking` |
| **Critical** | Data corruption / wrong vaccination records | Duplicate certificates, wrong pet linkage |
| **Critical** | Security breach | Webhook bypass, OTP brute-force at scale |
| **High** | SMS/OTP down >15 min with no queue drain | Worker crash loop |
| **High** | Payment double-charge pattern | Duplicate `orderPayment` despite guards |
| **High** | Staff cannot check-in >30 min at multiple sites | QR validation regression |
| **Medium** | Admin dashboard broken | Non-blocking if clinics operate |
| **Medium** | Landing cosmetic only | Do not rollback API for CSS-only issues |

**Decision authority:** On-call eng + Product Owner (clinic ops consulted for Critical).

---

## 2. Rollback strategies by layer

### 2.1 Backend API (`backend-api`)

| Strategy | When | Steps |
|----------|------|-------|
| **Redeploy previous image/tag** | Code regression | 1. Identify last known good commit/tag<br>2. Deploy previous container/artifact<br>3. Skip DB downgrade<br>4. Smoke test booking + staff check-in |
| **Feature flag — disable campaign routes** | Partial outage | Set env `CAMPAIGN_MODULE_ENABLED=false` if implemented; else use load balancer route drain to maintenance JSON |
| **Pause campaign** | Logic OK but bad config | Admin set campaign `status=PAUSED` — stops new bookings, preserves data |
| **Disable paid pricing** | Payment gateway failure | Switch campaign to FREE temporarily via admin (ops workaround) |

**Do NOT:** Run `prisma migrate down` on production after live bookings exist.

### 2.2 Database

| Action | Allowed | Notes |
|--------|---------|-------|
| Forward-fix migration | Yes | Preferred |
| Rollback migration | **No** (post-live data) | Campaign bookings are legal/health records |
| Restore from backup | Last resort | Point-in-time recovery; expect data loss since backup |
| Manual SQL hotfix | Yes, with change ticket | e.g. fix stuck DRAFT bookings |

**Backup before every prod deploy:** automated snapshot + verify restore procedure quarterly.

### 2.3 Landing (`vaccination_2026`)

| Strategy | Steps |
|----------|-------|
| Redeploy previous Vercel/hosting deployment | Use platform instant rollback to prior build |
| Maintenance page | Replace `/book` with static “Booking temporarily unavailable” while API fixed |
| Disable CTAs only | Keep informational landing live |

Landing rollback **does not** roll back API — coordinate with backend version compatibility.

### 2.4 Web admin + staff (`bpa_web`)

| Strategy | Steps |
|----------|-------|
| Redeploy previous frontend build | Staff bookmark `/staff/campaign` — verify after rollback |
| Staff fallback | Paper check-in forms + manual ref lookup on older staff build if compatible |

Staff portal depends on API contract — prefer API rollback first if staff mutations fail.

### 2.5 Flutter app (`bpa_app`)

| Strategy | Steps |
|----------|-------|
| No store rollback required for launch | Campaign hub is additive; older app versions simply lack menu |
| Block campaign-link API | API change only if linking endpoint breaks; app shows error state |

App rollback is **lowest priority**; optional for pilot.

### 2.6 Redis / SMS worker

| Strategy | Steps |
|----------|-------|
| Restart worker | `worker:notifications` with same Redis |
| Drain queue before rollback | Prevent lost SMS after code revert |
| Failover Redis | Use replica if primary down |

---

## 3. Rollback procedure (step-by-step)

### Phase A — Assess (0–5 min)

1. Confirm alert / user report in `#campaign-launch` channel  
2. Check API error rate, Redis queue depth, SMS failure logs  
3. Classify severity (Critical / High / Medium)  
4. Assign incident commander  

### Phase B — Contain (5–15 min)

1. If booking broken: **PAUSE campaign** in admin (fastest contain)  
2. If payment broken: pause + disable paid bookings messaging on landing  
3. If staff-only: keep public booking off, allow manual walk-in paper process  
4. Post status to clinic WhatsApp/group  

### Phase C — Roll back code (15–45 min)

1. Backend: deploy `N-1` tag  
2. Landing/Web: platform rollback to previous deployment  
3. Verify health endpoints  
4. Run smoke: public campaign list, one test booking (internal phone)  

### Phase D — Validate (45–60 min)

1. Staff test check-in at one clinic  
2. Confirm SMS worker processing  
3. Confirm no new duplicate payments in last hour  
4. Update status page — “Service restored”  

### Phase E — Post-incident

1. Preserve logs, webhook payloads, DB snapshots  
2. Root cause within 24h  
3. Update `03-BUG-LIST.md`  
4. Schedule fix-forward deploy  

---

## 4. Data integrity after rollback

| Concern | Action |
|---------|--------|
| Bookings created during bad deploy | Retain; do not delete |
| DRAFT unpaid bookings | Ops script to cancel or contact owners |
| Partial vaccinations | Complete in staff portal after fix; never delete vaccination rows |
| Duplicate SMS | Acceptable; log for support |
| Certificates already issued | Permanent; verify API still serves tokens |

---

## 5. Communication templates

**Clinics (SMS/WhatsApp):**  
> BPA Vaccination Campaign: Online booking is temporarily paused. If you have a confirmed booking ref, please attend as scheduled. Walk-ins accepted subject to capacity. Support: [number].

**Public (landing banner):**  
> We’re performing maintenance. Booking will reopen shortly. Thank you for your patience.

**Internal:**  
> Rollback executed to [tag]. Campaign status: PAUSED. Incident [ID]. Next update in 30 min.

---

## 6. Rollback test schedule

| Test | Frequency | Last done |
|------|-----------|-----------|
| Redeploy N-1 backend to staging | Before launch | [ ] |
| Landing hosting rollback | Before launch | [ ] |
| Campaign PAUSE stops new bookings | Before launch | [ ] |
| DB point-in-time restore drill | Quarterly | [ ] |

---

## 7. Related documents

- `06-DEPLOYMENT-PLAN.md` — deploy order (reverse for rollback)  
- `04-LAUNCH-CHECKLIST.md` — go/no-go  
- `19-risk-analysis.md` — contingency (paper forms)
