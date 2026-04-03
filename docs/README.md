# BPA Project Documentation

এই ফোল্ডারে প্রজেক্টের সব প্ল্যানিং ও ডিজাইন ডকুমেন্ট রাখা হয়েছে। মূল সোর্স ফোল্ডার (src, prisma, package.json ইত্যাদি) থেকে আলাদা রাখা হয়েছে যাতে ফাইলগুলো মিশে না যায়।

- **API:** সব প্ল্যানিং ডক এই `docs` ফোল্ডার থেকে পড়ে (`/api/v1/docs/list`, `/api/v1/docs/:slug`)।
- **Admin:** Planning & Docs → Admin প্যানেলে এই ডকগুলো ব্রাউজ করা যায়।
- **নিয়ম:** পরবর্তীতে যতগুলো নতুন .md ফাইল তৈরি হবে সেগুলো **এই docs/ ফোল্ডারের ভিতর** রাখতে হবে। রুটে শুধু README.md থাকবে।

**English — local API development:** [DEV_API_RUN_AND_DIST.md](./DEV_API_RUN_AND_DIST.md) (`npm run dev` vs `npm start`, stale `dist/` / “Route not found”).

**Clinic — prescription lifecycle (enterprise plan):** [CLINIC_PRESCRIPTION_FINALIZATION_LOCKING_AMENDMENT_PLAN.md](./CLINIC_PRESCRIPTION_FINALIZATION_LOCKING_AMENDMENT_PLAN.md) (finalization, locking, amendments, print/audit, phased rollout). Cross-links [CLINIC_PHARMACY_DATA_AND_API_SPEC.md](./CLINIC_PHARMACY_DATA_AND_API_SPEC.md) and [CLINIC_FLOW_AUDIT_TRAIL.md](./CLINIC_FLOW_AUDIT_TRAIL.md).

**Clinic — prescription permission migration (release operators):**

- **Runbook + checklist:** [CLINIC_PRESCRIPTION_WRITE_MIGRATION.md](./CLINIC_PRESCRIPTION_WRITE_MIGRATION.md) — start with **Release operator checklist** at top; then Phase 3 for SQL and detail.
- **Security audit (routes, middleware, verdict):** [CLINIC_PRESCRIPTION_SECURITY_AUDIT_REPORT.md](./CLINIC_PRESCRIPTION_SECURITY_AUDIT_REPORT.md) — **Rollout note** at top for `diagnose` / `migrate` / re-`diagnose` / object JSON.
- **Commands (per env, needs `DATABASE_URL`):** `npm run diagnose:prescription-write-overrides` → `npm run migrate:prescription-write-overrides` → `npm run diagnose:prescription-write-overrides` again.
