/**
 * @deprecated Use scripts/bootstrap-campaign-branch.ts (npm run bootstrap:campaign-branch).
 * Kept for backward compatibility — delegates to the canonical bootstrap.
 */
import prisma from "../src/infrastructure/db/prismaClient";
import { bootstrapCampaignBranch } from "./bootstrap-campaign-branch";

bootstrapCampaignBranch()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.resolverCheck.ok) process.exit(1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
