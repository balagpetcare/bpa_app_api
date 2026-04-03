/**
 * One-off: verify appointment #8 for collect-payment diagnosis.
 * Run: npx ts-node scripts/verify-appointment-8.ts
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  const apt = await prisma.appointment.findUnique({
    where: { id: 8 },
    select: {
      id: true,
      branchId: true,
      orgId: true,
      status: true,
      paymentStatus: true,
      patientId: true,
      petId: true,
    },
  });
  console.log("Appointment 8:", apt || "NOT FOUND");
  if (apt) {
    const branch = await prisma.branch.findUnique({
      where: { id: apt.branchId },
      select: { id: true, orgId: true, name: true },
    });
    console.log("Branch of appointment:", branch);
    const yourBranchId = 5;
    const yourBranch = await prisma.branch.findUnique({
      where: { id: yourBranchId },
      select: { id: true, orgId: true, name: true },
    });
    console.log("Your branch (UI branch 5):", yourBranch);
    const match =
      yourBranch &&
      apt.branchId === yourBranch.id &&
      apt.orgId === yourBranch.orgId;
    console.log("Eligible for collect-payment on branch 5?", match);
  }
  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
