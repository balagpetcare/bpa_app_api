/**
 * One-off audit: media URLs in DB + HTTP reachability.
 * Run: node scripts/audit-media-urls.mjs
 */
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function headUrl(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(t);
    return { status: res.status, ok: res.ok };
  } catch (e) {
    return { status: 0, ok: false, error: String(e?.message || e) };
  }
}

async function main() {
  const provider = String(process.env.STORAGE_PROVIDER || "minio").toLowerCase();
  const bucket =
    provider === "b2"
      ? process.env.S3_BUCKET || process.env.AWS_BUCKET_NAME
      : process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET || "bpa-pets";
  console.log("STORAGE_PROVIDER:", provider);
  console.log("Bucket:", bucket);
  console.log("Endpoint:", process.env.AWS_ENDPOINT || process.env.S3_ENDPOINT);
  console.log(
    "Public URL:",
    process.env.STORAGE_PUBLIC_URL || process.env.MINIO_PUBLIC_URL
  );

  const { rows: media } = await pool.query(`
    SELECT id, url, key, type, "mimeType"
    FROM media
    WHERE "deletedAt" IS NULL AND type = 'IMAGE'
    ORDER BY id DESC
    LIMIT 10
  `);
  console.log("\n=== Recent IMAGE media (DB) ===");
  for (const m of media) {
    const head = await headUrl(m.url);
    console.log({ id: m.id, type: m.type, key: m.key, url: m.url, http: head });
  }

  const { rows: posts } = await pool.query(`
    SELECT p.id, p.type, m.url, m.type AS media_type, m.key
    FROM posts p
    JOIN post_media pm ON pm."postId" = p.id
    JOIN media m ON m.id = pm."mediaId"
    WHERE p."deletedAt" IS NULL
    ORDER BY p.id DESC
    LIMIT 15
  `);
  console.log("\n=== Recent post media joins ===");
  for (const r of posts) {
    const head = r.url ? await headUrl(r.url) : { status: 0, ok: false };
    console.log({
      postId: r.id,
      postType: r.type,
      mediaType: r.media_type,
      key: r.key,
      url: r.url,
      http: head,
    });
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
