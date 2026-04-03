/**
 * Simulates what the getRequestById service function returns for request #2
 * with fromLocationId=2 (Central Hub). Verifies stock is now visible.
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const FROM_LOCATION_ID = 2;
    const ORG_ID = 1;

    // Get request #2 items
    const { rows: items } = await client.query(`
      SELECT sri.id, sri."variantId", sri."requestedQty",
             pv.title, p.name
      FROM stock_request_items sri
      JOIN products p ON p.id = sri."productId"
      JOIN product_variants pv ON pv.id = sri."variantId"
      WHERE sri."stockRequestId" = 2
    `);

    const variantIds = items.map(i => i.variantId);

    // Simulate aggregateStockByVariant (what the backend does)
    const { rows: balances } = await client.query(`
      SELECT "variantId", "onHandQty", "reservedQty"
      FROM stock_balances
      WHERE "locationId" = $1 AND "variantId" = ANY($2)
    `, [FROM_LOCATION_ID, variantIds]);

    const aggregateStockByVariant = {};
    for (const b of balances) {
      aggregateStockByVariant[b.variantId] = Math.max(0, b.onHandQty - b.reservedQty);
    }

    // Simulate availableLotsByVariant
    const { rows: lotBalances } = await client.query(`
      SELECT slb."locationId", slb."onHandQty", slb."reservedQty",
             sl.id as "lotId", sl."variantId", sl."lotCode", sl."expDate"
      FROM stock_lot_balances slb
      JOIN stock_lots sl ON sl.id = slb."lotId"
      WHERE slb."locationId" = $1
        AND slb."onHandQty" > 0
        AND sl."orgId" = $2
        AND sl."variantId" = ANY($3)
      ORDER BY sl."expDate" ASC
    `, [FROM_LOCATION_ID, ORG_ID, variantIds]);

    const lotsByVariant = {};
    for (const lb of lotBalances) {
      if (!lotsByVariant[lb.variantId]) lotsByVariant[lb.variantId] = [];
      lotsByVariant[lb.variantId].push({
        lotId: lb.lotId,
        lotCode: lb.lotCode,
        expDate: lb.expDate,
        onHandQty: lb.onHandQty,
        reservedQty: lb.reservedQty,
        effectiveAvailable: Math.max(0, lb.onHandQty - lb.reservedQty),
      });
    }

    // Simulate maxDispatchableByVariant
    const maxDispatchableByVariant = {};
    for (const vid of variantIds) {
      const aggStock = aggregateStockByVariant[vid] ?? 0;
      const lotTotal = (lotsByVariant[vid] || []).reduce((sum, l) => sum + l.effectiveAvailable, 0);
      maxDispatchableByVariant[vid] = Math.max(lotTotal, aggStock);
    }

    console.log('=== SIMULATED API RESPONSE FOR REQUEST #2 (fromLocationId=2) ===\n');

    for (const item of items) {
      const vid = item.variantId;
      const agg = aggregateStockByVariant[vid] ?? 0;
      const lots = lotsByVariant[vid] || [];
      const maxDisp = maxDispatchableByVariant[vid] ?? 0;
      const lotTotal = lots.reduce((s, l) => s + l.effectiveAvailable, 0);

      console.log(`Variant ${vid} (${item.name} ${item.title}):`);
      console.log(`  Requested: ${item.requestedQty}`);
      console.log(`  aggregateStock: ${agg}`);
      console.log(`  lotTotal: ${lotTotal}`);
      console.log(`  maxDispatchable: ${maxDisp}`);
      console.log(`  Lots: ${lots.length > 0 ? lots.map(l => `lot#${l.lotId} avail=${l.effectiveAvailable}`).join(', ') : 'none'}`);

      if (maxDisp >= item.requestedQty) {
        console.log(`  STATUS: SUFFICIENT STOCK`);
      } else if (maxDisp > 0) {
        console.log(`  STATUS: LOW STOCK (partial cover)`);
      } else {
        console.log(`  STATUS: NO STOCK`);
      }
      console.log('');
    }

    // Now check what the frontend's locations dropdown would show
    // Frontend calls GET /api/v1/inventory/locations
    // Let's check the inventory.controller.ts to see what that returns
    console.log('=== FRONTEND LOCATION DROPDOWN ===');
    console.log('The frontend calls GET /api/v1/inventory/locations');
    console.log('It then selects the FIRST location as the default fromLocationId');
    const { rows: locs } = await client.query(`
      SELECT il.id, il.name, il.type, il."branchId"
      FROM inventory_locations il
      JOIN branches b ON b.id = il."branchId"
      WHERE b."orgId" = $1 AND il."isActive" = true
      ORDER BY il.id
    `, [ORG_ID]);
    console.log('\nLocations returned:');
    for (const loc of locs) {
      console.log(`  #${loc.id}: "${loc.name}" type=${loc.type}`);
    }
    console.log(`\nDefault fromLocationId = ${locs[0]?.id} ("${locs[0]?.name}")`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
