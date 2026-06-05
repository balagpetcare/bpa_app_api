import "dotenv/config";
import bcrypt from "bcrypt";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function main() {
  const users = await q(`
    SELECT
      u.id AS user_id,
      u.status,
      up."displayName" AS name,
      up.username,
      ua.email,
      ua.phone,
      ua."passwordHash" IS NOT NULL AS has_password,
      ua."failedAttempts",
      ua."lockedUntil",
      COALESCE(
        json_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL),
        '[]'::json
      ) AS global_roles
    FROM users u
    LEFT JOIN user_profiles up ON up."userId" = u.id
    LEFT JOIN user_auth ua ON ua."userId" = u.id
    LEFT JOIN user_global_roles ugr ON ugr."userId" = u.id
    LEFT JOIN roles r ON r.id = ugr."roleId"
    WHERE u.id IN (SELECT DISTINCT "userId" FROM user_global_roles)
       OR ua.email ILIKE '%bangladeshpetassociation%'
       OR ua.phone IN ('01777889994', '017777889994', '01701022274')
    GROUP BY u.id, u.status, up."displayName", up.username, ua.email, ua.phone,
             ua."passwordHash", ua."failedAttempts", ua."lockedUntil"
    ORDER BY u.id
  `);

  const whitelist = await q(
    `SELECT id, email, phone, "isActive", note FROM super_admin_whitelist ORDER BY id`
  );

  const loginTests = [];
  const password = process.env.SUPER_ADMIN_PASSWORD || "";
  for (const cred of [
    { label: "env_email", email: process.env.SUPER_ADMIN_EMAIL, phone: null },
    { label: "env_phone", email: null, phone: process.env.SUPER_ADMIN_PHONE },
    { label: "admin_whitelist_email", email: "admin@bangladeshpetassociation.com", phone: null },
    { label: "admin_whitelist_phone", email: null, phone: "01701022274" },
  ]) {
    const email = cred.email ? String(cred.email).trim().toLowerCase() : null;
    const phone = cred.phone ? String(cred.phone).replace(/\D/g, "") : null;
    const phone11 = phone && phone.length > 11 ? phone.slice(-11) : phone;
    const rows = await q(
      `SELECT ua."userId", ua."passwordHash", ua.email, ua.phone
       FROM user_auth ua
       WHERE ($1::text IS NOT NULL AND LOWER(ua.email) = LOWER($1))
          OR ($2::text IS NOT NULL AND ua.phone = $2)
          OR ($3::text IS NOT NULL AND ua.phone = $3)
       LIMIT 1`,
      [email, phone, phone11]
    );
    if (!rows.length) {
      loginTests.push({ ...cred, found: false, passwordMatches: false, error: "User not found" });
      continue;
    }
    const row = rows[0];
    const passwordMatches = password
      ? await bcrypt.compare(password, row.passwordHash || "")
      : false;
    loginTests.push({
      label: cred.label,
      email: row.email,
      phone: row.phone,
      userId: row.userId,
      found: true,
      passwordMatches,
      error: passwordMatches ? null : password ? "Invalid password" : "SUPER_ADMIN_PASSWORD unset",
    });
  }

  console.log(
    JSON.stringify(
      {
        envConfigured: {
          SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL || null,
          SUPER_ADMIN_PHONE: process.env.SUPER_ADMIN_PHONE || null,
          hasSuperAdminPassword: Boolean(process.env.SUPER_ADMIN_PASSWORD),
          ADMIN_EMAILS: process.env.ADMIN_EMAILS || null,
          ADMIN_PHONES: process.env.ADMIN_PHONES || null,
        },
        users,
        whitelist,
        loginTests,
      },
      null,
      2
    )
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
