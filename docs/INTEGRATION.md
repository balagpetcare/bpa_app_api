## 1) Prisma
Paste `prisma/partner_onboarding.prisma.snippet` into your `prisma/schema.prisma`.

Add opposite relations (to prevent Prisma validation errors):
- User.partnerApplications PartnerApplication[]
- Organization.partnerApplications PartnerApplication[]
- User.partnerApplicationsReviewed PartnerApplication[]  (for reviewedBy relation name)

Then migrate:
- npx prisma migrate dev -n partner_onboarding
- npx prisma generate

## 2) Mount routes (Express)
```ts
import partnerRoutes from "./modules/partner/partner.routes";
import adminPartnerRoutes from "./modules/adminPartner/adminPartner.routes";
import { errorHandler } from "./middlewares/errorHandler";

app.use("/api/v1/partner", partnerRoutes);
app.use("/api/v1/admin/partner", adminPartnerRoutes);
app.use(errorHandler);
```

## 3) Auth integration
This patch assumes your auth layer sets:
- req.user = { id: number, permissions?: string[] }

If you use another mechanism, just replace `requireAuth` to populate/validate req.user.

## 4) Approve behavior (safe)
Approve will always:
- Create Organization
- Create Branch
- Link application -> organizationId, branchId, set status APPROVED

Role/UserRole assignment is OPTIONAL:
- If your Prisma has Role/UserRole models (with `key` and a unique compound index), you can enable it by editing:
  `src/modules/adminPartner/adminPartner.service.ts` (section: OPTIONAL_ROLE_ASSIGNMENT)
- If you already have your own staff/permission system, keep it disabled.
