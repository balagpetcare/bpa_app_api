# 04 — Launch Checklist

**Campaign:** BPA 2026 Cat Flu + Rabies Vaccination  
**Target launch window:** TBD (post-UAT sign-off)

---

## Production readiness score

**Overall: 74 / 100** — *Conditionally ready for limited pilot; not ready for full paid national launch.*

| Area | Weight | Score | Rationale |
|------|--------|-------|-----------|
| Backend core (booking, vaccination, certs) | 25% | **82** | Modules complete; routes mounted; partial unit tests |
| Payment & webhooks | 15% | **58** | Guards/idempotency fixed; **mock gateway** in non-prod path; coupon mismatch |
| SMS & notifications | 10% | **72** | Providers integrated; **Redis worker + prod creds** required; webhook auth weak |
| Web admin | 10% | **80** | Feature-complete; audit/SMS log gaps |
| Web staff portal | 10% | **83** | Mobile-first complete; PDF/browser caveats |
| Landing + booking | 15% | **86** | Build passes; strong UX; coupon/payment sync gap |
| Flutter app linking | 5% | **70** | Feature-complete; **no automated tests**; reminders local-only |
| Ops, migration, monitoring | 10% | **55** | Migration apply unverified; no E2E CI; runbooks partial |

**Weighted calculation:**  
(0.25×82) + (0.15×58) + (0.10×72) + (0.10×80) + (0.10×83) + (0.15×86) + (0.05×70) + (0.10×55) ≈ **74**

---

## Go / No-Go recommendation

### Recommendation: **CONDITIONAL GO** (pilot only) · **NO-GO** (full paid production)

| Launch mode | Decision | Conditions |
|-------------|----------|------------|
| **Pilot — FREE campaign, 1–2 clinics** | **GO** | P0 BUG-001 migration verified; Redis worker running; SMS creds in sandbox/live; staff trained; paper backup forms on-site |
| **Pilot — PAID campaign** | **NO-GO** | Requires BUG-002 real gateways + end-to-end payment UAT (Scenario 2) + BUG-004 coupon disabled or backend fix |
| **Full public launch (paid, multi-city)** | **NO-GO** | All P0 + payment/SMS P1 closed; UAT sign-off; load test; security review on webhooks |

**Executive summary:** Engineering delivery is **strong across all four surfaces**, but **operational and payment/SMS production wiring** remains the gating factor. Proceed with a **controlled pilot** to validate clinic operations; defer **paid scale-up** until payment gateway and coupon charging alignment are proven in staging.

---

## Pre-launch gates (all modes)

### Gate 1 — Infrastructure

- [ ] Production DB migration applied and verified (`\dt campaign_*`)
- [ ] `prisma generate` on deployment artifact
- [ ] API health check green
- [ ] Redis cluster available
- [ ] Notification worker deployed and monitored
- [ ] SSL certificates on API + landing + web domains
- [ ] Environment secrets in vault (not `.env` on disk)

### Gate 2 — Configuration

- [ ] Active campaign record (dates, slug, max pets)
- [ ] Locations + slots for launch week
- [ ] CampaignStaff rows for each clinic user
- [ ] Admin users granted `campaign.manage`
- [ ] `CAMPAIGN_PAYMENT_WEBHOOK_SECRET` set (if paid)
- [ ] SMS provider credentials + sender IDs approved
- [ ] `APP_URL` / callback URLs correct for each environment

### Gate 3 — Quality

- [ ] `01-QA-CHECKLIST.md` critical sections signed off
- [ ] `02-UAT-CHECKLIST.md` Scenarios 1, 5, 7 pass on staging
- [ ] Backend tests: `npm test -- --testPathPattern="campaign|sms"` green
- [ ] Landing `npm run build` green
- [ ] Web admin + staff smoke test complete
- [ ] Flutter staging APK smoke test (hub + import)
- [ ] `03-BUG-LIST.md` P0 count = 0 (or waived in writing)

### Gate 4 — Paid-only (additional)

- [ ] Real bKash/Nagad/SSLCommerz sandbox UAT complete
- [ ] Webhook registered with providers; secret validated
- [ ] Coupon UI hidden OR backend coupon API live
- [ ] Reconciliation process for failed webhooks documented
- [ ] Refund/cash walk-in process defined (BUG-203)

### Gate 5 — Operations

- [ ] Clinic runbook printed (check-in, vaccinate, certificate reprint)
- [ ] Paper backup forms at each site
- [ ] Support hotline + escalation matrix
- [ ] On-call rotation for launch weekend
- [ ] Rollback plan (`05-ROLLBACK-PLAN.md`) reviewed
- [ ] Deployment plan (`06-DEPLOYMENT-PLAN.md`) approved

### Gate 6 — Comms & legal

- [ ] Privacy notice covers phone, pet data, SMS
- [ ] Certificate disclaimer approved
- [ ] Public FAQ matches live pricing/benefits
- [ ] SMS opt-out policy (if applicable)

---

## Launch day timeline (template)

| Time | Activity | Owner |
|------|----------|-------|
| T-24h | Freeze deploys except hotfixes | Eng |
| T-2h | Final smoke: booking + staff check-in | QA |
| T-1h | Activate campaign status ACTIVE | Admin |
| T-0 | Open landing; monitor errors/SMS queue | All |
| T+1h | First booking + vaccination drill | Ops |
| T+4h | Metrics review (bookings, SMS failures) | Product |
| T+24h | Retrospective; update bug list | All |

---

## Success metrics (first 72 hours)

| Metric | Target |
|--------|--------|
| Booking success rate | ≥98% |
| Payment completion (if paid) | ≥90% of initiated |
| SMS delivery (OTP + confirm) | ≥95% |
| Check-in latency (scan → queue) | <30s median |
| Certificate generation success | ≥99% of vaccinations |
| P0 incidents | 0 |

---

## Sign-off

| Gate | Approver | Date | Go |
|------|----------|------|-----|
| Infrastructure | DevOps | | [ ] |
| Quality | QA Lead | | [ ] |
| Product | Product Owner | | [ ] |
| Operations | Clinic Lead | | [ ] |
| **Final launch** | Executive sponsor | | [ ] |

**Recorded decision:** _______________ (**GO** / **NO-GO** / **CONDITIONAL GO**)
