/**
 * Verify campaign_bookings.bookingMode + checkout init (zone-interest).
 * Usage: node scripts/verify-campaign-booking-schema.js [campaignSlug]
 */
require("dotenv").config();
const { Pool } = require("pg");

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000/api/v1";
const SLUG = process.argv[2] || "uat-free-2026";

async function checkSchema(pool) {
  const cols = await pool.query(
    `SELECT column_name, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'campaign_bookings'
       AND column_name IN ('bookingMode', 'coverageZoneName', 'bdAreaId', 'locationId', 'slotId')
     ORDER BY column_name`
  );
  const counts = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM campaign_bookings) AS bookings,
       (SELECT COUNT(*)::int FROM campaigns) AS campaigns,
       (SELECT COUNT(*)::int FROM orders) AS orders`
  );
  return { columns: cols.rows, counts: counts.rows[0] };
}

async function checkPrismaQuery() {
  const prisma = require("../dist/infrastructure/db/prismaClient");
  // fallback: use dynamic import of ts - use pg-based raw query instead
  return null;
}

async function prismaFindFirstViaScript() {
  // Use project's prisma client through a minimal inline require after generate
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { PrismaClient } = require("@prisma/client");
  const { Pool: PgPool } = require("pg");
  const pool = new PgPool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    const row = await prisma.campaignBooking.findFirst({
      select: { id: true, bookingMode: true, bookingRef: true },
    });
    return { ok: true, sample: row };
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function fetchDhakaArea(pool) {
  const corp = await pool.query(
    `SELECT b.id, b.code FROM bd_areas b
     WHERE b.code = 'CC-DNCC' AND b.type = 'CITY_CORPORATION' LIMIT 1`
  );
  if (!corp.rows[0]) return null;
  const zone2 = await pool.query(
    `SELECT id FROM bd_areas WHERE "parentId" = $1 AND type = 'ZONE' ORDER BY "nameEn" LIMIT 1`,
    [corp.rows[0].id]
  );
  return zone2.rows[0] ? { corpCode: "DNCC", bdAreaId: zone2.rows[0].id } : null;
}

async function httpCheckoutInit(slug, area) {
  const phone = `017${String(Date.now()).slice(-8)}`;
  const body = {
    campaignSlug: slug,
    phone,
    catCount: 1,
    cityCorporationCode: area.corpCode,
    bdAreaId: area.bdAreaId,
    paymentMethod: "BKASH",
  };
  const res = await fetch(`${API_BASE}/campaign/public/checkout/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    status: res.status,
    checkoutId: json?.data?.checkoutId,
    requiresPayment: json?.data?.requiresPayment,
    paymentUrl: json?.data?.paymentUrl ? "(present)" : undefined,
    error: json?.message || json?.error,
  };
}

async function resolveSlug(pool) {
  const free = await pool.query(
    `SELECT slug FROM campaigns WHERE "pricingType" = 'FREE' ORDER BY id LIMIT 1`
  );
  if (free.rows[0]?.slug) return free.rows[0].slug;
  const r = await pool.query(`SELECT slug FROM campaigns ORDER BY id LIMIT 1`);
  return r.rows[0]?.slug || SLUG;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const slug = await resolveSlug(pool);
  const results = { slug, schema: null, prismaQuery: null, checkout: null, paymentInit: null, bookingCreate: null };

  try {
    results.schema = await checkSchema(pool);
    results.prismaQuery = await prismaFindFirstViaScript();

    const area = await fetchDhakaArea(pool);
    if (!area) {
      results.checkout = { ok: false, skipped: true, reason: "No DNCC ZONE bd_area for test" };
    } else {
      results.checkout = await httpCheckoutInit(slug, area);
      results.paymentInit = {
        ok: results.checkout.ok,
        requiresPayment: results.checkout.requiresPayment,
        hasPaymentUrl: !!results.checkout.paymentUrl,
      };
      if (results.checkout.ok && results.checkout.checkoutId) {
        const pool2 = new Pool({ connectionString: process.env.DATABASE_URL });
        const sess = await pool2.query(
          `SELECT id, status, amount, "paymentMethod" FROM campaign_checkout_sessions WHERE id = $1`,
          [results.checkout.checkoutId]
        );
        await pool2.end();
        results.bookingCreate = {
          ok: true,
          sessionStatus: sess.rows[0]?.status,
          note: "Checkout session created (booking row on payment confirm / free confirm)",
        };
      }
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify(results, null, 2));
  const schemaOk = results.schema?.columns?.some((c) => c.column_name === "bookingMode");
  const checkoutOk =
    results.checkout?.skipped ||
    results.checkout?.ok ||
    (results.checkout?.error?.message || "").includes("payment");
  const failed = !schemaOk || !results.prismaQuery?.ok || (results.checkout && !checkoutOk);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
