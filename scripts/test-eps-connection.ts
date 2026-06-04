/**
 * EPS gateway DNS + HTTPS connectivity test (no credentials logged).
 *
 * Usage:
 *   npx ts-node scripts/test-eps-connection.ts
 *   npx ts-node scripts/test-eps-connection.ts --host=sandboxpgapi.eps.com.bd
 */

import * as dns from "dns/promises";
import * as https from "https";
import * as tls from "tls";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const DEFAULT_HOSTS = [
  { label: "sandbox API (correct)", host: "sandboxpgapi.eps.com.bd" },
  { label: "production API", host: "pgapi.eps.com.bd" },
  { label: "legacy broken (hyphen)", host: "sandbox-pgapi.eps.com.bd" },
  { label: "payment UI only", host: "sandboxpg.eps.com.bd" },
];

function loadDotEnv(): void {
  const envPath = resolve(__dirname, "../.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function parseHostArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--host="));
  return arg ? arg.split("=")[1]?.trim() || null : null;
}

function hostFromEnvBaseUrl(): string | null {
  const raw = process.env.EPS_BASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

async function resolveDns(host: string): Promise<void> {
  console.log("  DNS lookup:");
  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) {
      console.log("    (no addresses returned)");
      return;
    }
    for (const r of records) {
      console.log(`    ${r.address} (${r.family === 6 ? "IPv6" : "IPv4"})`);
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log(`    FAIL [${err.code || "DNS_ERROR"}] ${err.message}`);
  }
}

function httpsHead(host: string, path: string): Promise<{ status?: number; error?: string; ssl?: string }> {
  return new Promise((resolvePromise) => {
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path,
        method: "HEAD",
        timeout: 20_000,
        rejectUnauthorized: true,
      },
      (res) => {
        res.resume();
        resolvePromise({ status: res.statusCode });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolvePromise({ error: "ETIMEDOUT" });
    });
    req.on("error", (e) => {
      const err = e as NodeJS.ErrnoException & { code?: string };
      let ssl: string | undefined;
      if (err.code === "ENOTFOUND") {
        ssl = "DNS resolution failed before TLS";
      } else if (err.code === "CERT_HAS_EXPIRED" || err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
        ssl = `TLS/cert: ${err.code}`;
      } else if (err.message?.includes("certificate")) {
        ssl = `TLS: ${err.message}`;
      }
      resolvePromise({ error: `${err.code || "ERROR"}: ${err.message}`, ssl });
    });
    req.end();
  });
}

async function tlsHandshake(host: string): Promise<void> {
  console.log("  TLS handshake:");
  await new Promise<void>((done) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: 20_000 },
      () => {
        const cert = socket.getPeerCertificate();
        console.log(`    OK | protocol=${socket.getProtocol()} | authorized=${socket.authorized}`);
        if (cert?.subject) {
          console.log(`    subject CN=${(cert.subject as { CN?: string }).CN ?? "(n/a)"}`);
        }
        socket.end();
        done();
      }
    );
    socket.on("error", (e) => {
      const err = e as NodeJS.ErrnoException;
      console.log(`    FAIL [${err.code || "TLS_ERROR"}] ${err.message}`);
      done();
    });
    socket.on("timeout", () => {
      socket.destroy();
      console.log("    FAIL [ETIMEDOUT] TLS handshake timed out");
      done();
    });
  });
}

async function probeHost(label: string, host: string): Promise<void> {
  console.log(`\n--- ${label}: ${host} ---`);
  await resolveDns(host);
  await tlsHandshake(host);
  const paths = ["/", "/v1/Auth/GetToken"];
  for (const path of paths) {
    const r = await httpsHead(host, path);
    if (r.status != null) {
      console.log(`  HTTPS HEAD ${path}: HTTP ${r.status}`);
    } else {
      console.log(`  HTTPS HEAD ${path}: ${r.error}`);
      if (r.ssl) console.log(`    ${r.ssl}`);
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const customHost = parseHostArg();
  const envHost = hostFromEnvBaseUrl();

  console.log("EPS connection test\n");
  if (process.env.EPS_BASE_URL) {
    console.log(`EPS_BASE_URL (env): ${process.env.EPS_BASE_URL}`);
  } else {
    console.log("EPS_BASE_URL (env): (not set — app uses code default when EPS is active)");
  }
  console.log(`EPS_SANDBOX (env): ${process.env.EPS_SANDBOX ?? "(unset → true)"}`);

  if (envHost) {
    await probeHost("configured EPS_BASE_URL host", envHost);
  }

  const hosts = customHost
    ? [{ label: "custom --host", host: customHost }]
    : DEFAULT_HOSTS;

  for (const h of hosts) {
    await probeHost(h.label, h.host);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
