/**
 * Forensic audit of stock availability for request #2.
 * Queries DB directly to find the truth about stock for each variant.
 */
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    // 1. Get request #2 details
    const { rows: reqRows } = await client.query(`
      SELECT sr.id, sr."orgId", sr."branchId", sr.status, sr."submittedAt",
             b.name as "branchName", o.name as "orgName"
      FROM stock_requests sr
      JOIN branches b ON b.id = sr."branchId"
      JOIN organizations o ON o.id = sr."orgId"
      WHERE sr.id = 2
    `);
    console.log('=== REQUEST #2 ===');
    console.log(JSON.stringify(reqRows[0], null, 2));

    // 2. Get request items
    const { rows: items } = await client.query(`
      SELECT sri.id, sri."productId", sri."variantId", sri."requestedQty", sri."fulfilledQty",
             sri."cancelledQty", sri."lineKind",
             p.name as "productName", pv.title as "variantTitle", pv.sku
      FROM stock_request_items sri
      JOIN products p ON p.id = sri."productId"
      JOIN product_variants pv ON pv.id = sri."variantId"
      WHERE sri."stockRequestId" = 2
      ORDER BY sri.id
    `);
    console.log('\n=== REQUEST #2 ITEMS ===');
    for (const i of items) {
      console.log(`  Item #${i.id}: variant=${i.variantId} (${i.variantTitle || i.sku}) product=${i.productName} reqQty=${i.requestedQty} fulQty=${i.fulfilledQty} cancelQty=${i.cancelledQty}`);
    }

    const variantIds = items.map(i => i.variantId);
    console.log(`\nVariant IDs to check: [${variantIds.join(', ')}]`);

    // 3. Get ALL inventory locations for this org
    const orgId = reqRows[0]?.orgId;
    const { rows: allLocations } = await client.query(`
      SELECT il.id, il."branchId", il.name, il.type, il."isActive",
             b.name as "branchName"
      FROM inventory_locations il
      LEFT JOIN branches b ON b.id = il."branchId"
      WHERE il."branchId" IN (SELECT id FROM branches WHERE "orgId" = $1)
      OR il.id IN (SELECT id FROM inventory_locations WHERE "branchId" IS NULL)
      ORDER BY il.id
    `, [orgId]);
    console.log('\n=== ALL INVENTORY LOCATIONS FOR ORG ===');
    for (const loc of allLocations) {
      console.log(`  Location #${loc.id}: "${loc.name}" type=${loc.type} branch=${loc.branchName ?? 'null'} active=${loc.isActive}`);
    }

    // 4. For each variant, check stock_balances at every location
    console.log('\n=== STOCK BALANCES BY VARIANT AND LOCATION ===');
    for (const vid of variantIds) {
      const { rows: balances } = await client.query(`
        SELECT sb."locationId", sb."onHandQty", sb."reservedQty",
               il.name as "locationName", il.type as "locationType"
        FROM stock_balances sb
        JOIN inventory_locations il ON il.id = sb."locationId"
        WHERE sb."variantId" = $1
      `, [vid]);
      console.log(`\n  Variant ${vid}:`);
      if (balances.length === 0) {
        console.log('    NO stock_balance rows found!');
      }
      for (const b of balances) {
        console.log(`    Location #${b.locationId} "${b.locationName}" (${b.locationType}): onHand=${b.onHandQty} reserved=${b.reservedQty} effective=${b.onHandQty - b.reservedQty}`);
      }
    }

    // 5. For each variant, check stock_lot_balances
    console.log('\n=== STOCK LOT BALANCES BY VARIANT AND LOCATION ===');
    for (const vid of variantIds) {
      const { rows: lotBalances } = await client.query(`
        SELECT slb."locationId", slb."onHandQty", slb."reservedQty",
               sl.id as "lotId", sl."expDate", sl."mfgDate", sl."lotCode",
               il.name as "locationName"
        FROM stock_lot_balances slb
        JOIN stock_lots sl ON sl.id = slb."lotId"
        JOIN inventory_locations il ON il.id = slb."locationId"
        WHERE sl."variantId" = $1
        ORDER BY sl."expDate" ASC NULLS LAST
      `, [vid]);
      console.log(`\n  Variant ${vid}:`);
      if (lotBalances.length === 0) {
        console.log('    NO lot balance rows found!');
      }
      for (const lb of lotBalances) {
        console.log(`    Location #${lb.locationId} "${lb.locationName}" lot=${lb.lotId} code="${lb.lotCode}" exp=${lb.expDate} onHand=${lb.onHandQty} reserved=${lb.reservedQty}`);
      }
    }

    // 6. Check what the owner locations API returns
    // The frontend calls GET /api/v1/inventory/locations
    // Let's see what locations exist for this owner's org
    const { rows: ownerUser } = await client.query(`
      SELECT "ownerUserId" FROM organizations WHERE id = $1
    `, [orgId]);
    console.log(`\n=== OWNER USER ===`);
    console.log(`  Owner user ID: ${ownerUser[0]?.ownerUserId}`);

    // 7. Check if there's a "Central Hub" location
    const { rows: centralHub } = await client.query(`
      SELECT il.id, il.name, il.type, il."branchId", il."isActive"
      FROM inventory_locations il
      WHERE il.name ILIKE '%central%' OR il.name ILIKE '%hub%' OR il.name ILIKE '%main%'
      ORDER BY il.id
    `);
    console.log('\n=== CENTRAL HUB / MAIN LOCATIONS ===');
    for (const loc of centralHub) {
      console.log(`  Location #${loc.id}: "${loc.name}" type=${loc.type} branchId=${loc.branchId} active=${loc.isActive}`);
    }

    // 8. Check the branch's own inventory locations
    const branchId = reqRows[0]?.branchId;
    const { rows: branchLocs } = await client.query(`
      SELECT id, name, type, "isActive"
      FROM inventory_locations
      WHERE "branchId" = $1
    `, [branchId]);
    console.log(`\n=== BRANCH #${branchId} INVENTORY LOCATIONS ===`);
    for (const loc of branchLocs) {
      console.log(`  Location #${loc.id}: "${loc.name}" type=${loc.type} active=${loc.isActive}`);
    }

    // 9. Check what fromLocationId the frontend would send
    // It selects from GET /api/v1/inventory/locations
    // Let's also check all inventory locations with orgId context
    const { rows: allOrgLocs } = await client.query(`
      SELECT il.id, il.name, il.type, il."branchId", il."isActive",
             b.name as "branchName", b."orgId"
      FROM inventory_locations il
      LEFT JOIN branches b ON b.id = il."branchId"
      WHERE b."orgId" = $1 OR il."branchId" IS NULL
      ORDER BY il.id
    `, [orgId]);
    console.log(`\n=== ALL LOCATIONS (org ${orgId} context) ===`);
    for (const loc of allOrgLocs) {
      console.log(`  Location #${loc.id}: "${loc.name}" type=${loc.type} branchId=${loc.branchId} branchName=${loc.branchName} orgId=${loc.orgId} active=${loc.isActive}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
