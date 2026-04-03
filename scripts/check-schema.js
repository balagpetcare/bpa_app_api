const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'stock_balances'
    ORDER BY ordinal_position
  `);
  console.log('=== stock_balances columns ===');
  for (const r of rows) {
    console.log(`  ${r.column_name} (${r.data_type}) nullable=${r.is_nullable} default=${r.column_default}`);
  }

  const { rows: rows2 } = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'stock_lots'
    ORDER BY ordinal_position
  `);
  console.log('\n=== stock_lots columns ===');
  for (const r of rows2) {
    console.log(`  ${r.column_name} (${r.data_type}) nullable=${r.is_nullable} default=${r.column_default}`);
  }

  const { rows: rows3 } = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'stock_lot_balances'
    ORDER BY ordinal_position
  `);
  console.log('\n=== stock_lot_balances columns ===');
  for (const r of rows3) {
    console.log(`  ${r.column_name} (${r.data_type}) nullable=${r.is_nullable} default=${r.column_default}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
