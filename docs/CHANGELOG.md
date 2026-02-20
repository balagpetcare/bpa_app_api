# Changelog

## Global-Ready Next.js Phase 5 (bpa_web 100%)
- **bpa_web Phase 5:** X-Country-Code in apiFetch (src/lib/apiFetch.js); CountrySwitcher component + navbar; usePolicyFeatures in MasterLayout; policy-based menu (hide Fundraising when !donationEnabled); Admin Fundraising page (hold list, Approve/Reject). See [NEXTJS_GLOBAL_READY_PHASE5_CHECKLIST.md](./NEXTJS_GLOBAL_READY_PHASE5_CHECKLIST.md).

## Product Authenticity MVP (started)
- **Schema:** Added core models (Factory, ProductionLine, ProductVersion, PackagingTemplate, ProductFingerprint, Contract, QuotaPlan, QuotaUsage, Batch, SerialRange, Serial, ScanEvent).
- **API:** Added batch + serial endpoints and public verify/scan; added product version endpoints.
- **Docs:** [PRODUCT_AUTHENTICITY_MVP_APPLY.md](./PRODUCT_AUTHENTICITY_MVP_APPLY.md).

## Global-Ready API (Phases 1–4 complete)
- **API 100%:** Phase 1 (Country + Policy + Context), Phase 2 (Donation + Compliance), Phase 3 (Storage + Location + Payment), Phase 4 (Ads + Govt Reporting + RBAC) – all touch points verified and documented in [API_GLOBAL_READY_PHASES_CHECKLIST.md](./API_GLOBAL_READY_PHASES_CHECKLIST.md).
- **.env.example:** Uncommented and added Phase 1–4 env vars (COUNTRY_DEFAULT, POLICY_CACHE_TTL_SEC, RL_DONATION_*, STORAGE_USE_COUNTRY_PREFIX, RL_GEOCODE_*, GOVT_REPORTING_*, CORS_ORIGINS).

## 10.0.1
- Add /me/menu endpoint and repo standard docs.
