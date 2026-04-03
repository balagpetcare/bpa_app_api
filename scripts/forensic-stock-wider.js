const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // 1. Total stock_balance rows in the system
    const { rows: totalBal } = await client.query(`
      SELECT COUNT(*)::int as cnt, SUM("onHandQty")::int as total_on_hand
      FROM stock_balances WHERE "onHandQty" > 0
    `);
    console.log('=== TOTAL STOCK BALANCES (onHand > 0) ===');
    console.log(`  Rows: ${totalBal[0].cnt}, Total on-hand: ${totalBal[0].total_on_hand}`);

    // 2. Stock balances at the Central Hub location (#2)
    const { rows: hubBal } = await client.query(`
      SELECT sb."variantId", sb."onHandQty", sb."reservedQty",
             pv.title as "variantTitle", pv.sku, p.name as "productName"
      FROM stock_balances sb
      JOIN product_variants pv ON pv.id = sb."variantId"
      JOIN products p ON p.id = pv."productId"
      WHERE sb."locationId" = 2 AND sb."onHandQty" > 0
      ORDER BY sb."onHandQty" DESC
      LIMIT 20
    `);
    console.log('\n=== STOCK AT CENTRAL HUB (Location #2) — top 20 ===');
    if (hubBal.length === 0) {
      console.log('  NO stock at Central Hub!');
    }
    for (const b of hubBal) {
      console.log(`  Variant ${b.variantId} (${b.variantTitle || b.sku}): ${b.productName} | onHand=${b.onHandQty} reserved=${b.reservedQty}`);
    }

    // 3. Stock balances at ANY location for variants 277, 194, 340 products
    // Check by product ID, not variant ID
    const { rows: items } = await client.query(`
      SELECT "productId", "variantId" FROM stock_request_items WHERE "stockRequestId" = 2
    `);
    const productIds = [...new Set(items.map(i => i.productId))];
    console.log(`\n=== PRODUCTS IN REQUEST #2: [${productIds.join(', ')}] ===`);

    // Check ALL variants of these products
    const { rows: allVariants } = await client.query(`
      SELECT pv.id, pv."productId", pv.title, pv.sku, pv."isActive",
             p.name as "productName"
      FROM product_variants pv
      JOIN products p ON p.id = pv."productId"
      WHERE pv."productId" = ANY($1)
      ORDER BY pv."productId", pv.id
    `, [productIds]);
    console.log('\n=== ALL VARIANTS OF REQUEST #2 PRODUCTS ===');
    for (const v of allVariants) {
      console.log(`  Variant ${v.id}: product=${v.productName} title="${v.title}" sku="${v.sku}" active=${v.isActive}`);
    }

    // Check stock for ALL variants of these products
    const allVariantIds = allVariants.map(v => v.id);
    const { rows: varStock } = await client.query(`
      SELECT sb."variantId", sb."locationId", sb."onHandQty", sb."reservedQty",
             il.name as "locationName"
      FROM stock_balances sb
      JOIN inventory_locations il ON il.id = sb."locationId"
      WHERE sb."variantId" = ANY($1)
    `, [allVariantIds]);
    console.log('\n=== STOCK FOR ALL VARIANTS OF REQUEST #2 PRODUCTS ===');
    if (varStock.length === 0) {
      console.log('  NO stock for any variant of these products!');
    }
    for (const s of varStock) {
      console.log(`  Variant ${s.variantId} @ Location #${s.locationId} "${s.locationName}": onHand=${s.onHandQty} reserved=${s.reservedQty}`);
    }

    // 4. Check total stock_lot_balance rows
    const { rows: totalLot } = await client.query(`
      SELECT COUNT(*)::int as cnt FROM stock_lot_balances WHERE "onHandQty" > 0
    `);
    console.log(`\n=== TOTAL LOT BALANCES (onHand > 0): ${totalLot[0].cnt} ===`);

    // 5. Check GRN (goods received notes) for these products - see if anything was ever received
    const { rows: grns } = await client.query(`
      SELECT gl."variantId", gl.quantity, gl."receivedQty",
             g.status, g."createdAt"
      FROM grn_lines gl
      JOIN grns g ON g.id = gl."grnId"
      WHERE gl."variantId" = ANY($1)
      ORDER BY g."createdAt" DESC
      LIMIT 10
    `, [allVariantIds]);
    console.log('\n=== GRN LINES FOR THESE VARIANTS ===');
    if (grns.length === 0) {
      console.log('  No GRN lines found — products were never received into inventory!');
    }
    for (const g of grns) {
      console.log(`  Variant ${g.variantId}: qty=${g.quantity} received=${g.receivedQty} status=${g.status} date=${g.createdAt}`);
    }

    // 6. Check if request #1 exists and its state
    const { rows: req1 } = await client.query(`
      SELECT sr.id, sr.status FROM stock_requests sr WHERE sr.id = 1
    `);
    console.log(`\n=== REQUEST #1: ${req1[0]?.status ?? 'NOT FOUND'} ===`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
