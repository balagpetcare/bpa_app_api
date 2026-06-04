require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const orgs = await p.query(
    `SELECT id, name, "orgType", status FROM organizations WHERE "deletedAt" IS NULL ORDER BY id`
  );
  const branches = await p.query(`SELECT id, "orgId", name, status FROM branches ORDER BY id`);
  const campaigns = await p.query(`SELECT id, slug, "organizerId", "pricingType" FROM campaigns ORDER BY id`);
  const users = await p.query(`SELECT id FROM users ORDER BY id LIMIT 10`);
  console.log(JSON.stringify({ orgs: orgs.rows, branches: branches.rows, campaigns: campaigns.rows, users: users.rows }, null, 2));
  await p.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
