/**
 * Direct initCheckout test (bypasses HTTP) — verifies bookingMode DB path.
 */
import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";
import { initCheckout, confirmFreeCheckout } from "../src/api/v1/modules/campaign/checkout.service";

async function main() {
  const campaign = await prisma.campaign.findFirst({
    orderBy: { id: "asc" },
    select: { slug: true, pricingType: true, priceAmount: true },
  });
  if (!campaign?.slug) {
    console.log(JSON.stringify({ ok: false, error: "No campaign" }));
    process.exit(1);
  }

  const corp = await prisma.bdArea.findFirst({
    where: { code: "CC-DNCC", type: "CITY_CORPORATION" },
    select: { id: true },
  });
  const zone = corp
    ? await prisma.bdArea.findFirst({
        where: { parentId: corp.id, type: "ZONE" },
        select: { id: true, nameEn: true },
      })
    : null;

  if (!zone) {
    console.log(JSON.stringify({ ok: false, error: "No DNCC zone for dhaka test" }));
    process.exit(1);
  }

  const phone = `017${String(Date.now()).slice(-8)}`;
  let init: Awaited<ReturnType<typeof initCheckout>>;
  try {
    init = await initCheckout({
      campaignSlug: campaign.slug,
      phone,
      cityCorporationCode: "DNCC",
      bdAreaId: zone.id,
      catCount: 1,
      paymentMethod: "BKASH",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const session = await prisma.campaignCheckoutSession.findFirst({
      where: { ownerPhone: phone.replace(/\s+/g, "") },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, addressJson: true },
    });
    const passedDb =
      msg.includes("payment") ||
      msg.includes("Payment") ||
      msg.includes("SSL") ||
      msg.includes("EPS") ||
      msg.includes("eps");
    console.log(
      JSON.stringify(
        {
          ok: passedDb && !!session,
          flow: "init_partial",
          campaign: campaign.slug,
          error: msg,
          sessionCreated: !!session,
          addressBookingMode: (session?.addressJson as { bookingMode?: string })?.bookingMode,
        },
        null,
        2
      )
    );
    await prisma.$disconnect();
    process.exit(passedDb && session ? 0 : 1);
  }

  let bookingMode: string | null = null;
  if (!init.requiresPayment) {
    const confirmed = await confirmFreeCheckout(init.checkoutId);
    const b = await prisma.campaignBooking.findUnique({
      where: { bookingRef: confirmed.bookingRef! },
      select: { id: true, bookingMode: true, status: true, bdAreaId: true },
    });
    bookingMode = b?.bookingMode ?? null;
    console.log(
      JSON.stringify(
        {
          ok: true,
          flow: "free_confirm",
          checkoutId: init.checkoutId,
          bookingRef: confirmed.bookingRef,
          bookingMode: b?.bookingMode,
          status: b?.status,
          bdAreaId: b?.bdAreaId,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      JSON.stringify(
        { ok: true, flow: "paid_init_only", checkoutId: init.checkoutId, requiresPayment: true },
        null,
        2
      )
    );
  }

  await prisma.$disconnect();
  process.exit(bookingMode === "ZONE_INTEREST" || init.requiresPayment ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
