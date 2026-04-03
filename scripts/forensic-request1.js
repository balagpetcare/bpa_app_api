const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // Request #1
    const { rows: req1 } = await client.query(`
      SELECT sr.id, sr."orgId", sr."branchId", sr.status FROM stock_requests sr WHERE sr.id = 1
    `);
    console.log('=== REQUEST #1 ===');
    console.log(JSON.stringify(req1[0] ?? 'NOT FOUND', null, 2));

    if (req1[0]) {
      const { rows: items1 } = await client.query(`
        SELECT sri.id, sri."productId", sri."variantId", sri."requestedQty",
               p.name, pv.title
        FROM stock_request_items sri
        JOIN products p ON p.id = sri."productId"
        JOIN product_variants pv ON pv.id = sri."variantId"
        WHERE sri."stockRequestId" = 1
      `);
      console.log('\n=== REQUEST #1 ITEMS ===');
      for (const i of items1) {
        console.log(`  Variant ${i.variantId} (${i.title}): ${i.name} reqQty=${i.requestedQty}`);
      }

      // Check stock for request #1 variants
      const vids = items1.map(i => i.variantId);
      if (vids.length > 0) {
        const { rows: stock1 } = await client.query(`
          SELECT sb."variantId", sb."locationId", sb."onHandQty", sb."reservedQty",
                 il.name as "locationName"
          FROM stock_balances sb
          JOIN inventory_locations il ON il.id = sb."locationId"
          WHERE sb."variantId" = ANY($1) AND sb."onHandQty" > 0
        `, [vids]);
        console.log('\n=== STOCK FOR REQUEST #1 VARIANTS ===');
        for (const s of stock1) {
          console.log(`  Variant ${s.variantId} @ #${s.locationId} "${s.locationName}": onHand=${s.onHandQty}`);
        }
        if (stock1.length === 0) console.log('  NO stock for request #1 variants either!');
      }
    }

    // Check which variants DO have stock
    const { rows: stockedVariants } = await client.query(`
      SELECT sb."variantId", sb."locationId", sb."onHandQty",
             pv.title, pv.sku, p.name as "productName", p.id as "productId"
      FROM stock_balances sb
      JOIN product_variants pv ON pv.id = sb."variantId"
      JOIN products p ON p.id = pv."productId"
      WHERE sb."locationId" = 2 AND sb."onHandQty" > 0
      ORDER BY sb."onHandQty" DESC
    `);
    console.log('\n=== VARIANTS WITH STOCK AT CENTRAL HUB ===');
    for (const s of stockedVariants) {
      console.log(`  productId=${s.productId} variantId=${s.variantId} "${s.productName}" (${s.title}): onHand=${s.onHandQty}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
