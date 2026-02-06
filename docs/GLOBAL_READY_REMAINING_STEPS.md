# Global-Ready – বাকি স্টেপ (Remaining Steps)

**সম্পন্ন:** Phase 1 (Foundation), Phase 2 (Donation + Compliance), Phase 3 (Storage + Payment + Location)
**রেফারেন্স:** [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md)

---

## Phase 4: Ads + Govt Reporting + RBAC (২–৪ সপ্তাহ)

| Step | Task | টাচ পয়েন্ট |
|------|------|----------------|
| **4.1** | Ads model + basic serve API (country targeting) | prisma/schema.prisma (Ad model: country, target_countries), migration, minimal API |
| **4.2** | Govt reporting hook (threshold → notify) | New hook/service: when donation/threshold exceeded → log or notify (structure only) |
| **4.3** | Global + Country roles (DB + API) | Schema: SUPER_ADMIN, COMPLIANCE_ADMIN, PLATFORM_FINANCE (Global); COUNTRY_ADMIN, COUNTRY_COMPLIANCE, etc. (Country); migration + API |
| **4.4** | Permission (Scope + Action) in API + UI | (Scope: Global/Country/Org/Branch) + Action; menu + API same source |

---

## Phase 5: Frontend + App (২–৩ সপ্তাহ)

| Step | Task | টাচ পয়েন্ট |
|------|------|----------------|
| **5.1** | bpa_web: X-Country-Code বা subdomain; API কলে country পাঠানো | bpa_web: API client এ header `X-Country-Code` বা subdomain থেকে country; সব API request এ যুক্ত |
| **5.2** | bpa_app: country select (first launch); persist; configs apply | Flutter: প্রথম লঞ্চে country picker (auto-detect + manual); persist; terms/currency apply |
| **5.3** | Donation/Ads policy অনুযায়ী UI লুকানো/নিষ্ক্রিয় | bpa_web + bpa_app: policy থেকে DONATION/ADS off থাকলে সেই ফিচার হাইড বা ডিজেবল; reason_code দেখানো |

---

## Phase 6: Docs + Launch Prep (ongoing)

| Step | Task |
|------|------|
| **6.1** | GLOBAL_READY_MASTER.md, DEVELOPER_ONBOARDING_GLOBAL.md যোগ করা |
| **6.2** | COUNTRY_POLICY_ENGINE_DESIGN.md, AML_KYC_FLOW.md, MVP_GLOBAL_LAUNCH_CHECKLIST.md |
| **6.3** | PROJECT_CONTEXT.md এ Global-Ready সেকশন আপডেট |
| **6.4** | New country rollout checklist (দেশ যোগ, policy তৈরি, features চালু, মনিটর) |

---

## অপশনাল / পরবর্তী (Phase 2 এক্সটেনশন)

| Item | বিবরণ |
|------|--------|
| **AML/risk service** | Threshold, frequency, pattern চেক করে donation status স্বয়ংক্রিয় ON_HOLD_REVIEW/KYC_REQUIRED সেট করা (এখন শুধু admin manually approve/reject) |
| **Photon fallback** | Geocode এ Nominatim fail করলে Photon fallback (LOCATION_MODULE_SPEC) |
| **Self-hosted Nominatim** | Production এ নিজের geocoder (rate limit এড়াতে) |

---

## সংক্ষেপ

- **Phase 4:** Ads মডেল + Govt reporting hook + Global/Country roles + Permission (Scope + Action)
- **Phase 5:** bpa_web/bpa_app এ country header + country picker + policy-based UI (Donation/Ads hide/disable)
- **Phase 6:** মাস্টার ডক, অনবোর্ডিং, Policy Engine ডিজাইন, AML/KYC ফ্লো, লঞ্চ চেকলিস্ট, PROJECT_CONTEXT আপডেট, দেশ রোলআউট চেকলিস্ট

পরবর্তী স্প্রিন্টে Phase 4 দিয়ে শুরু করা যেতে পারে; অথবা Phase 5 (Frontend country + policy UI) আগে করলে ইউজার এক্সপেরিয়েন্স দ্রুত ঠিক থাকে।
