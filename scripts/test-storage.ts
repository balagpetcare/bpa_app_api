/**
 * End-to-end storage integration smoke test.
 * Exercises connect, upload, read, signed URL, public URL, delete.
 *
 * Usage:
 *   npm run storage:test
 *   STORAGE_PROVIDER=b2 npm run storage:test
 *
 * Does not touch business logic or the database.
 */

require("dotenv").config();
const crypto = require("crypto");

const {
  resolveStorageConfig,
  validateStorageConfig,
} = require("../src/infrastructure/storage/storage.config");
const { resetStorageProviderForTests } = require("../src/infrastructure/storage/storage.factory");
const { validateStorageOnStartup } = require("../src/infrastructure/storage/storage.bootstrap");
const { getStorageProvider } = require("../src/infrastructure/storage/storage.factory");

type StepResult = {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
};

function maskSecret(value: string): string {
  const s = String(value || "");
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function runStep(name: string, fn: () => Promise<string | void>): Promise<StepResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - start, detail: detail || undefined };
  } catch (err: any) {
    return {
      name,
      ok: false,
      ms: Date.now() - start,
      error: err?.message || String(err),
    };
  }
}

async function main() {
  resetStorageProviderForTests();

  const config = resolveStorageConfig();
  const configErrors = validateStorageConfig(config);

  console.log("\n=== BPA Storage Integration Test ===\n");
  console.log("Provider:", config.provider);
  console.log("Bucket:", config.bucketName);
  console.log("Endpoint:", config.endpoint);
  console.log("Public URL base:", config.publicUrl || "(not set)");
  console.log("Access key:", maskSecret(config.accessKeyId));
  console.log("Force path style:", config.forcePathStyle);
  console.log("");

  if (configErrors.length) {
    console.log("Config validation errors:");
    configErrors.forEach((e) => console.log("  -", e));
    console.log("");
  }

  const startup = await validateStorageOnStartup();
  console.log("Startup validation:", startup.ok ? "PASS" : "FAIL");
  if (startup.warnings.length) {
    console.log("Warnings:");
    startup.warnings.forEach((w) => console.log("  -", w));
  }
  if (startup.errors.length) {
    console.log("Errors:");
    startup.errors.forEach((e) => console.log("  -", e));
  }
  console.log("");

  const provider = getStorageProvider();
  const rand = crypto.randomBytes(6).toString("hex");
  const testKey = `BD/_storage_test/${Date.now()}_${rand}.txt`;
  const testBody = Buffer.from(`bpa-storage-integration-test-${config.provider}-${Date.now()}`);
  const contentType = "text/plain; charset=utf-8";

  const results: StepResult[] = [];

  results.push(
    await runStep("connect (HeadBucket via startup)", async () => {
      if (!startup.ok && config.provider === "b2") {
        throw new Error(startup.errors.join("; ") || "startup validation failed");
      }
      return `provider=${startup.provider}`;
    })
  );

  results.push(
    await runStep("upload (PutObject)", async () => {
      await provider.putObject({ key: testKey, body: testBody, contentType });
      const exists = await provider.objectExists(testKey);
      if (!exists) throw new Error("objectExists returned false after upload");
      return `key=${testKey} bytes=${testBody.length}`;
    })
  );

  results.push(
    await runStep("read (GetObject)", async () => {
      const obj = await provider.getObject(testKey);
      const buf = await streamToBuffer(obj.body);
      if (!buf.equals(testBody)) {
        throw new Error(`content mismatch: expected ${testBody.length} bytes, got ${buf.length}`);
      }
      return `bytes=${buf.length} contentType=${obj.contentType || contentType}`;
    })
  );

  let signedUrl = "";
  results.push(
    await runStep("signed URL (presigned GET)", async () => {
      signedUrl = await provider.getSignedGetUrl(testKey, 300);
      if (!signedUrl || !signedUrl.startsWith("http")) {
        throw new Error("invalid presigned URL");
      }
      const res = await fetch(signedUrl);
      if (!res.ok) {
        throw new Error(`presigned GET HTTP ${res.status}`);
      }
      const text = await res.text();
      if (text !== testBody.toString()) {
        throw new Error("presigned GET content mismatch");
      }
      return `url=${signedUrl.slice(0, 80)}... status=${res.status}`;
    })
  );

  results.push(
    await runStep("public URL (buildPublicUrl)", async () => {
      const publicUrl = provider.buildPublicUrl(testKey);
      if (!publicUrl) throw new Error("empty public URL");
      try {
        const res = await fetch(publicUrl, { method: "HEAD" });
        const note =
          res.ok
            ? `HEAD ${res.status}`
            : `HEAD ${res.status} (public access may require bucket/CDN policy)`;
        return `url=${publicUrl} ${note}`;
      } catch (e: any) {
        return `url=${publicUrl} fetch_failed=${e?.message || e}`;
      }
    })
  );

  results.push(
    await runStep("delete (DeleteObject)", async () => {
      await provider.deleteObject(testKey);
      const exists = await provider.objectExists(testKey);
      if (exists) throw new Error("object still exists after delete");
      return `key=${testKey} removed`;
    })
  );

  console.log("--- Step results ---\n");
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    if (r.ok) passed++;
    else failed++;
    console.log(`${status}  ${r.name}  (${r.ms}ms)`);
    if (r.detail) console.log(`       ${r.detail}`);
    if (r.error) console.log(`       ERROR: ${r.error}`);
  }

  console.log("\n--- Summary ---\n");
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  console.log(`Provider: ${config.provider}`);
  console.log("");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFatal:", err?.message || err);
  process.exit(1);
});

export {};
