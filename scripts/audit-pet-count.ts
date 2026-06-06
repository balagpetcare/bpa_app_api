/**
 * Audit CampaignBooking rows with petCount = 0.
 * Usage: npx ts-node --transpile-only scripts/audit-pet-count.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import prisma from "../src/infrastructure/db/prismaClient";

async function main() {
  const zeroRows = await prisma.campaignBooking.findMany({
    where: { petCount: 0 },
    select: {
      id: true,
      bookingRef: true,
      campaignId: true,
      status: true,
      bookingMode: true,
      ownerPhone: true,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  });

  const total = await prisma.campaignBooking.count();
  const report = {
    generatedAt: new Date().toISOString(),
    totalBookings: total,
    zeroPetCountBookings: zeroRows.length,
    rows: zeroRows,
  };

  const outPath = path.join(__dirname, "..", "docs", "reports", "pet-count-audit.md");
  const md = `# Pet Count Audit

**Generated:** ${report.generatedAt}

## Summary

| Metric | Count |
|--------|-------|
| Total bookings | ${report.totalBookings} |
| Bookings with \`petCount = 0\` | ${report.zeroPetCountBookings} |

## Policy

- New bookings reject \`petCount < 1\` at validation and service layers.
- Existing zero-count rows are **not deleted** automatically.

## Zero pet count rows

${
  zeroRows.length
    ? zeroRows
        .map(
          (r) =>
            `- \`${r.bookingRef}\` — campaign ${r.campaignId}, status ${r.status}, mode ${r.bookingMode}, phone ${r.ownerPhone}, created ${r.createdAt.toISOString()}`
        )
        .join("\n")
    : "_None found._"
}
`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report written to ${outPath}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
