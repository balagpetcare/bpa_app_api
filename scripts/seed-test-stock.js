/**
 * Seeds stock balances and lot balances at the Central Hub (location #2)
 * for all variants referenced by stock requests #1 and #2.
 *
 * This is idempotent: uses upsert to avoid duplicates.
 * Only adds stock where none exists.
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CENTRAL_HUB_LOCATION_ID = 2;
const ORG_ID = 1;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get all variant IDs from requests #1 and #2
    const { rows: items } = await client.query(`
      SELECT DISTINCT sri."variantId", sri."productId", sri."requestedQty",
             pv.title as "variantTitle", p.name as "productName"
      FROM stock_request_items sri
      JOIN product_variants pv ON pv.id = sri."variantId"
      JOIN products p ON p.id = sri."productId"
      WHERE sri."stockRequestId" IN (1, 2)
      ORDER BY sri."variantId"
    `);

    console.log(`Found ${items.length} unique variant lines across requests #1 and #2\n`);

    let seededBalances = 0;
    let seededLots = 0;
    let skippedBalances = 0;

    for (const item of items) {
      const vid = item.variantId;
      const pid = item.productId;

      // Check if stock_balance already exists
      const { rows: existing } = await client.query(
        `SELECT "onHandQty" FROM stock_balances WHERE "locationId" = $1 AND "variantId" = $2`,
        [CENTRAL_HUB_LOCATION_ID, vid]
      );

      if (existing.length > 0 && existing[0].onHandQty > 0) {
        console.log(`  SKIP variant ${vid} (${item.productName} ${item.variantTitle}): already has ${existing[0].onHandQty} on hand`);
        skippedBalances++;
        continue;
      }

      // Determine a reasonable stock quantity (3x requested, minimum 500)
      const stockQty = Math.max(500, (item.requestedQty || 100) * 3);

      // Upsert stock_balance
      await client.query(`
        INSERT INTO stock_balances ("locationId", "variantId", "onHandQty", "reservedQty", "updatedAt")
        VALUES ($1, $2, $3, 0, NOW())
        ON CONFLICT ("locationId", "variantId")
        DO UPDATE SET "onHandQty" = EXCLUDED."onHandQty", "updatedAt" = NOW()
        WHERE stock_balances."onHandQty" = 0
      `, [CENTRAL_HUB_LOCATION_ID, vid, stockQty]);

      console.log(`  SEED variant ${vid} (${item.productName} ${item.variantTitle}): ${stockQty} units at Central Hub`);
      seededBalances++;

      // Create a stock lot for FEFO tracking
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + 12); // 12 months from now

      const mfgDate = new Date();
      mfgDate.setMonth(mfgDate.getMonth() - 2); // 2 months ago

      const lotCode = `SEED-${vid}-${Date.now().toString(36).toUpperCase()}`;

      // Create lot
      const { rows: lotRows } = await client.query(`
        INSERT INTO stock_lots ("orgId", "variantId", "lotCode", "expDate", "mfgDate", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id
      `, [ORG_ID, vid, lotCode, expDate, mfgDate]);

      const lotId = lotRows[0].id;

      // Create lot balance
      await client.query(`
        INSERT INTO stock_lot_balances ("locationId", "lotId", "onHandQty", "reservedQty", "updatedAt")
        VALUES ($1, $2, $3, 0, NOW())
        ON CONFLICT ("locationId", "lotId") DO NOTHING
      `, [CENTRAL_HUB_LOCATION_ID, lotId, stockQty]);

      console.log(`    + Lot ${lotId} (${lotCode}): exp ${expDate.toISOString().split('T')[0]}, ${stockQty} units`);
      seededLots++;
    }

    await client.query('COMMIT');

    console.log(`\n=== SUMMARY ===`);
    console.log(`  Stock balances seeded: ${seededBalances}`);
    console.log(`  Lots created: ${seededLots}`);
    console.log(`  Skipped (already had stock): ${skippedBalances}`);

    // Verify
    console.log('\n=== VERIFICATION ===');
    const { rows: verify } = await client.query(`
      SELECT sb."variantId", sb."onHandQty", sb."reservedQty",
             pv.title, p.name as "productName"
      FROM stock_balances sb
      JOIN product_variants pv ON pv.id = sb."variantId"
      JOIN products p ON p.id = pv."productId"
      WHERE sb."locationId" = $1
      AND sb."variantId" IN (
        SELECT DISTINCT "variantId" FROM stock_request_items WHERE "stockRequestId" IN (1, 2)
      )
      ORDER BY sb."variantId"
    `, [CENTRAL_HUB_LOCATION_ID]);

    for (const v of verify) {
      console.log(`  Variant ${v.variantId} (${v.productName} ${v.title}): onHand=${v.onHandQty} reserved=${v.reservedQty}`);
    }

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
