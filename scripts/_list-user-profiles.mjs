import pg from "pg";

const client = new pg.Client({
  host: "localhost",
  port: 5432,
  user: "bpa_admin",
  password: "password123",
  database: "bpa_pet_db",
});
await client.connect();

const profiles = await client.query(`
  SELECT u.id, u.status, p.phone, p.email, p."fullName", p.role
  FROM users u
  LEFT JOIN user_profiles p ON p."userId" = u.id
  ORDER BY u.id
`);
console.log(JSON.stringify(profiles.rows, null, 2));

await client.end();
