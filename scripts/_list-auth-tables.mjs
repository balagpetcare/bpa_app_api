import pg from "pg";

const client = new pg.Client({
  host: "localhost",
  port: 5432,
  user: "bpa_admin",
  password: "password123",
  database: "bpa_pet_db",
});
await client.connect();

for (const table of ["user_auth", "user_profiles"]) {
  const r = await client.query(`SELECT * FROM ${table} ORDER BY 1 LIMIT 10`);
  console.log(`\n=== ${table} (${r.rowCount} rows shown) ===`);
  console.log(JSON.stringify(r.rows, null, 2));
}

await client.end();
