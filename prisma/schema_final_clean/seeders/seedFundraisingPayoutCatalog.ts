import { PrismaClient } from "@prisma/client";

/**
 * Seed default payout method catalog entries.
 * Admin can later enable/disable or add more via admin panel.
 */
export default async function seedFundraisingPayoutCatalog(prisma: PrismaClient) {
  const items = [
    {
      code: "BKASH",
      name: "bKash",
      type: "MFS" as const,
      requirementsJson: JSON.stringify({
        fields: [
          { key: "walletNumber", label: "Wallet Number", required: true },
          { key: "accountType", label: "Account Type", required: false },
        ],
      }),
    },
    {
      code: "NAGAD",
      name: "Nagad",
      type: "MFS" as const,
      requirementsJson: JSON.stringify({
        fields: [{ key: "walletNumber", label: "Wallet Number", required: true }],
      }),
    },
    {
      code: "ROCKET",
      name: "Rocket",
      type: "MFS" as const,
      requirementsJson: JSON.stringify({
        fields: [{ key: "walletNumber", label: "Wallet Number", required: true }],
      }),
    },
    {
      code: "BANK",
      name: "Bank Transfer",
      type: "BANK" as const,
      requirementsJson: JSON.stringify({
        fields: [
          { key: "bankName", label: "Bank Name", required: true },
          { key: "branch", label: "Branch", required: false },
          { key: "accountName", label: "Account Name", required: true },
          { key: "accountNumber", label: "Account Number", required: true },
          { key: "routingNumber", label: "Routing Number", required: false },
        ],
      }),
    },
  ];

  for (const it of items) {
    await prisma.fundraisingPayoutMethodCatalog.upsert({
      where: { code: it.code },
      update: {
        name: it.name,
        type: it.type,
        requirementsJson: it.requirementsJson,
        isActive: true,
      },
      create: {
        code: it.code,
        name: it.name,
        type: it.type,
        requirementsJson: it.requirementsJson,
        isActive: true,
      },
    });
  }
}
