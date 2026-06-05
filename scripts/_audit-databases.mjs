/**
 * Read-only audit of local PostgreSQL for BPA database recovery.
 * Tries known credential pairs from project history.
 */
import pg from "pg";

const CREDS = [
  { user: "postgres", password: "postgres", label: "postgres/postgres" },
  { user: "postgres", password: "", label: "postgres/(empty)" },
  { user: "bpa_admin", password: "password123", label: "bpa_admin/password123 (docker-compose)" },
  { user: "postgres", password: "password123", label: "postgres/password123" },
];

const BPA_DB_PATTERN = /bpa|pet|onboarding|wpa|vaccin|campaign/i;

const CORE_TABLES = [
  "_prisma_migrations",
  "User",
  "users",
  "Organization",
  "organizations",
  "Branch",
  "branches",
  "Pet",
  "pets",
  "Clinic",
  "clinics",
  "Product",
  "products",
  "Booking",
  "bookings",
  "CampaignBooking",
  "campaign_bookings",
  "VaccinationRecord",
  "vaccination_records",
];

async function tryConnect(cred) {
  const client = new pg.Client({
    host: "localhost",
    port: 5432,
    user: cred.user,
    password: cred.password,
    database: "postgres",
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    return client;
  } catch (e) {
    return null;
  }
}

async function listDatabases(client) {
  const r = await client.query(
    `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`
  );
  return r.rows.map((x) => x.datname);
}

async function listRoles(client) {
  const r = await client.query(
    `SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolcanlogin ORDER BY rolname`
  );
  return r.rows;
}

async function auditDatabase(cred, dbName) {
  const client = new pg.Client({
    host: "localhost",
    port: 5432,
    user: cred.user,
    password: cred.password,
    database: dbName,
    connectionTimeoutMillis: 5000,
  });
  const out = {
    database: dbName,
    connected: false,
    error: null,
    tableCount: 0,
    migrationCount: 0,
    latestMigration: null,
    counts: {},
    bpaScore: 0,
  };
  try {
    await client.connect();
    out.connected = true;

    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    out.tableCount = tables.rows.length;
    const names = new Set(tables.rows.map((r) => r.table_name));

    if (names.has("_prisma_migrations")) {
      const mig = await client.query(
        `SELECT COUNT(*)::int AS c, MAX(finished_at) AS latest FROM _prisma_migrations WHERE rolled_back_at IS NULL`
      );
      out.migrationCount = mig.rows[0]?.c ?? 0;
      out.latestMigration = mig.rows[0]?.latest ?? null;
      out.bpaScore += 10;
    }

    const countQueries = [
      ["users", 'SELECT COUNT(*)::int AS c FROM "User"'],
      ["users_lower", "SELECT COUNT(*)::int AS c FROM users"],
      ["organizations", 'SELECT COUNT(*)::int AS c FROM "Organization"'],
      ["organizations_lower", "SELECT COUNT(*)::int AS c FROM organizations"],
      ["branches", 'SELECT COUNT(*)::int AS c FROM "Branch"'],
      ["branches_lower", "SELECT COUNT(*)::int AS c FROM branches"],
      ["pets", 'SELECT COUNT(*)::int AS c FROM "Pet"'],
      ["pets_lower", "SELECT COUNT(*)::int AS c FROM pets"],
      ["products", 'SELECT COUNT(*)::int AS c FROM "Product"'],
      ["products_lower", "SELECT COUNT(*)::int AS c FROM products"],
      ["bookings", 'SELECT COUNT(*)::int AS c FROM "Booking"'],
      ["campaign_bookings", 'SELECT COUNT(*)::int AS c FROM "CampaignBooking"'],
      ["campaign_bookings_snake", "SELECT COUNT(*)::int AS c FROM campaign_bookings"],
    ];

    for (const [key, sql] of countQueries) {
      try {
        const r = await client.query(sql);
        const c = r.rows[0]?.c ?? 0;
        if (c > 0) {
          out.counts[key] = c;
          out.bpaScore += Math.min(c, 100);
        }
      } catch {
        /* table absent */
      }
    }

    if (out.tableCount > 50) out.bpaScore += 20;
    if (out.migrationCount > 50) out.bpaScore += 15;
  } catch (e) {
    out.error = e.message;
  } finally {
    await client.end().catch(() => {});
  }
  return out;
}

async function main() {
  let client = null;
  let cred = null;
  for (const c of CREDS) {
    client = await tryConnect(c);
    if (client) {
      cred = c;
      break;
    }
  }
  if (!client) {
    console.log(JSON.stringify({ error: "Could not connect to PostgreSQL on localhost:5432 with known credentials" }));
    process.exit(1);
  }

  const databases = await listDatabases(client);
  const roles = await listRoles(client);
  await client.end();

  const candidates = databases.filter((d) => BPA_DB_PATTERN.test(d));
  const audits = [];
  for (const db of databases) {
    if (db === "postgres" || db.endsWith("_shadow")) continue;
    const a = await auditDatabase(cred, db);
    if (a.connected && (a.tableCount > 0 || BPA_DB_PATTERN.test(db))) {
      audits.push(a);
    }
  }

  audits.sort((a, b) => b.bpaScore - a.bpaScore);

  console.log(
    JSON.stringify(
      {
        connectedAs: cred.label,
        roles: roles.map((r) => r.rolname),
        allDatabases: databases,
        bpaNamedDatabases: candidates,
        audits,
        recommended: audits[0] ?? null,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
