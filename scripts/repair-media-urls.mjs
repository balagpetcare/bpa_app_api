/**
 * Sync media.url in DB from media.key + MINIO_PUBLIC_URL.
 * Run after changing MINIO_PUBLIC_URL or recovering MinIO.
 *
 *   node scripts/repair-media-urls.mjs
 */
import "dotenv/config";
import pg from "pg";

const provider = String(process.env.STORAGE_PROVIDER || "minio").toLowerCase();
const bucket =
  provider === "b2"
    ? process.env.S3_BUCKET || process.env.AWS_BUCKET_NAME || "bpa-production-media"
    : process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET || "bpa-pets";
const base = (
  process.env.STORAGE_PUBLIC_URL ||
  process.env.MINIO_PUBLIC_URL ||
  process.env.AWS_ENDPOINT ||
  process.env.S3_ENDPOINT ||
  ""
).replace(/\/$/, "");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!base) {
    console.error("Set MINIO_PUBLIC_URL or AWS_ENDPOINT");
    process.exit(1);
  }

  const { rows } = await pool.query(
    `SELECT id, url, key FROM media WHERE "deletedAt" IS NULL AND key IS NOT NULL`
  );

  let updated = 0;
  for (const row of rows) {
    const canonical = `${base}/${bucket}/${String(row.key).replace(/^\//, "")}`;
    if (canonical !== row.url) {
      await pool.query(`UPDATE media SET url = $1 WHERE id = $2`, [canonical, row.id]);
      console.log("updated", row.id, canonical);
      updated++;
    }
  }

  console.log(`Done. ${updated}/${rows.length} rows updated.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
