import pg from "pg";

const client = new pg.Client({
  host: "localhost",
  port: 5432,
  user: "bpa_admin",
  password: "password123",
  database: "bpa_pet_db",
});

const tables = [
  "users",
  "organizations",
  "branches",
  "pets",
  "products",
  "clinics",
  "campaign_bookings",
  "orders",
  "inventory_items",
  "vaccination_records",
  "campaigns",
  "staff_invites",
];

await client.connect();

console.log("=== Record counts (bpa_pet_db) ===");
for (const t of tables) {
  try {
    const r = await client.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
    console.log(`${t}: ${r.rows[0].c}`);
  } catch {
    console.log(`${t}: MISSING`);
  }
}

const users = await client.query(`SELECT * FROM users ORDER BY id LIMIT 5`);
console.log("\n=== Users sample ===");
console.log(JSON.stringify(users.rows, null, 2));

const orgs = await client.query(`SELECT id, name FROM organizations LIMIT 5`);
console.log("\n=== Organizations ===");
console.log(JSON.stringify(orgs.rows, null, 2));

const mig = await client.query(
  `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5`
);
console.log("\n=== Latest migrations ===");
console.log(JSON.stringify(mig.rows, null, 2));

await client.end();

// Test missing databases
console.log("\n=== Other DB connection tests ===");
for (const { user, password, db } of [
  { user: "postgres", password: "postgres", db: "bpa_dev" },
  { user: "postgres", password: "postgres", db: "bpa_onboarding" },
  { user: "bpa_admin", password: "password123", db: "bpa_dev" },
]) {
  const c = new pg.Client({ host: "localhost", port: 5432, user, password, database: db });
  try {
    await c.connect();
    console.log(`OK: ${user}@${db}`);
    await c.end();
  } catch (e) {
    console.log(`FAIL: ${user}@${db} — ${e.message.split("\n")[0]}`);
  }
}
