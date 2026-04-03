/**
 * Repair stock_request_items.fulfilledQty from transfer history (source of truth).
 *
 * Old bugs: overwrite instead of increment, legacy dispatch mirroring variant total to every line.
 * This script recomputes per-line fulfilled quantities from SUM(stock_transfer_items.quantitySent)
 * per variant per stock request, then apportions in stable line id order (REQUESTED first, then EXTRA).
 *
 * Usage:
 *   node scripts/repair-stock-request-fulfilled-qty.js --dry-run
 *   node scripts/repair-stock-request-fulfilled-qty.js --dry-run --request-id=2
 *   node scripts/repair-stock-request-fulfilled-qty.js --dry-run --request-id=2 --verbose
 *   node scripts/repair-stock-request-fulfilled-qty.js --apply --request-id=2
 *
 * @see docs/stock-request-data-repair-and-verification.md
 */
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function parseArgs(argv) {
  const out = { dryRun: true, requestId: null, apply: false, verbose: false };
  for (const a of argv.slice(2)) {
    if (a === "--apply") {
      out.apply = true;
      out.dryRun = false;
    }
    if (a === "--dry-run") {
      out.dryRun = true;
      out.apply = false;
    }
    if (a === "--verbose" || a === "-v") {
      out.verbose = true;
    }
    if (a.startsWith("--request-id=")) {
      out.requestId = Number(a.split("=")[1]);
    }
  }
  return out;
}

/**
 * @param {Array<{id:number, variantId:number, requestedQty:number, cancelledQty:number, lineKind:string|null}>} items
 * @param {Map<number, number>} qtyByVariant  total quantitySent per variant for this request
 * @returns {Map<number, number>} proposed fulfilledQty per item id
 */
function computeProposedFulfilled(items, qtyByVariant) {
  const proposed = new Map();

  for (const [variantId, T] of qtyByVariant) {
    if (T <= 0) continue;
    const lines = items
      .filter((i) => i.variantId === variantId)
      .sort((a, b) => a.id - b.id);
    if (!lines.length) continue;

    const requested = lines.filter((i) => i.lineKind !== "EXTRA");
    const extras = lines.filter((i) => i.lineKind === "EXTRA");

    let left = T;

    if (requested.length === 0 && extras.length > 0) {
      if (extras.length === 1) {
        proposed.set(extras[0].id, (proposed.get(extras[0].id) || 0) + T);
      } else {
        const sorted = [...extras].sort((a, b) => a.id - b.id);
        const base = Math.floor(T / sorted.length);
        let mod = T % sorted.length;
        for (let j = 0; j < sorted.length; j++) {
          const add = base + (j < mod ? 1 : 0);
          proposed.set(sorted[j].id, (proposed.get(sorted[j].id) || 0) + add);
        }
      }
      continue;
    }

    for (let i = 0; i < requested.length; i++) {
      const line = requested[i];
      const isLastReq = i === requested.length - 1;
      const cap = Math.max(0, line.requestedQty - line.cancelledQty);
      let alloc;
      if (!isLastReq) {
        alloc = Math.min(left, cap);
      } else if (extras.length === 0) {
        alloc = left;
      } else {
        alloc = Math.min(left, cap);
      }
      proposed.set(line.id, alloc);
      left -= alloc;
    }

    if (extras.length === 1) {
      const e = extras[0];
      proposed.set(e.id, (proposed.get(e.id) || 0) + left);
    } else if (extras.length > 1) {
      const sorted = [...extras].sort((a, b) => a.id - b.id);
      let rem = left;
      const base = Math.floor(rem / sorted.length);
      let mod = rem % sorted.length;
      for (let j = 0; j < sorted.length; j++) {
        const add = base + (j < mod ? 1 : 0);
        proposed.set(sorted[j].id, (proposed.get(sorted[j].id) || 0) + add);
      }
    }
  }

  for (const it of items) {
    if (!proposed.has(it.id)) proposed.set(it.id, 0);
  }
  return proposed;
}

async function main() {
  const opts = parseArgs(process.argv);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const reqParams = [];
    let reqWhere = "";
    if (Number.isFinite(opts.requestId) && opts.requestId > 0) {
      reqWhere = "AND sr.id = $1";
      reqParams.push(Number(opts.requestId));
    }

    const { rows: requestRows } = await client.query(
      `
      SELECT DISTINCT sr.id, sr.status, sr."createdAt"
      FROM stock_requests sr
      INNER JOIN stock_transfers st ON st."stockRequestId" = sr.id
      WHERE 1=1 ${reqWhere}
      ORDER BY sr.id
    `,
      reqParams
    );

    console.log(
      opts.apply ? "MODE: APPLY (writes DB)\n" : "MODE: DRY-RUN (no writes)\n"
    );
    console.log(`Requests with linked transfers: ${requestRows.length}\n`);

    const report = [];

    for (const sr of requestRows) {
      const requestId = sr.id;

      const { rows: items } = await client.query(
        `
        SELECT id, "variantId", "requestedQty", "fulfilledQty", "cancelledQty",
               "lineKind"::text AS "lineKind"
        FROM stock_request_items
        WHERE "stockRequestId" = $1
        ORDER BY id
      `,
        [requestId]
      );

      const { rows: transferSums } = await client.query(
        `
        SELECT sti."variantId"::int AS "variantId",
               SUM(sti."quantitySent")::bigint AS total_sent
        FROM stock_transfer_items sti
        INNER JOIN stock_transfers st ON st.id = sti."transferId"
        WHERE st."stockRequestId" = $1
        GROUP BY sti."variantId"
      `,
        [requestId]
      );

      const qtyByVariant = new Map();
      for (const r of transferSums) {
        qtyByVariant.set(r.variantId, Number(r.total_sent));
      }

      const proposed = computeProposedFulfilled(items, qtyByVariant);

      const changes = [];
      for (const it of items) {
        const before = it.fulfilledQty;
        const after = proposed.get(it.id) ?? 0;
        if (before !== after) {
          changes.push({
            itemId: it.id,
            variantId: it.variantId,
            lineKind: it.lineKind,
            before,
            after,
            reason: "reconcile from SUM(stock_transfer_items.quantitySent) per variant + line-order apportion",
          });
        }
      }

      const suspicious = items.filter((it) => {
        const cap = it.lineKind === "EXTRA" ? null : Math.max(0, it.requestedQty - it.cancelledQty);
        if (cap != null && it.fulfilledQty > cap + 0.001 && it.lineKind !== "EXTRA") {
          return true;
        }
        return false;
      });

      report.push({
        requestId,
        status: sr.status,
        itemCount: items.length,
        variantTotals: Object.fromEntries(qtyByVariant),
        changes,
        suspiciousBefore: suspicious.map((s) => ({
          id: s.id,
          variantId: s.variantId,
          requested: s.requestedQty,
          fulfilled: s.fulfilledQty,
        })),
      });

      if (changes.length || opts.verbose) {
        console.log(`--- Request #${requestId} (${sr.status}) ---`);
        console.log("Variant totals from transfers:", JSON.stringify(Object.fromEntries(qtyByVariant)));
        if (opts.verbose) {
          for (const it of items) {
            const prop = proposed.get(it.id) ?? 0;
            const mark = it.fulfilledQty !== prop ? " *" : "";
            console.log(
              `  item ${it.id} variant ${it.variantId} [${it.lineKind}] db=${it.fulfilledQty} proposed=${prop}${mark}`
            );
          }
        }
        for (const c of changes) {
          console.log(
            `  item ${c.itemId} variant ${c.variantId} [${c.lineKind}]: ${c.before} -> ${c.after}`
          );
        }
        console.log("");
      }

      if (opts.apply && changes.length) {
        await client.query("BEGIN");
        try {
          for (const c of changes) {
            await client.query(
              `UPDATE stock_request_items SET "fulfilledQty" = $1, "updatedAt" = NOW() WHERE id = $2`,
              [c.after, c.itemId]
            );
          }
          await client.query("COMMIT");
          console.log(`Request #${requestId}: applied ${changes.length} updates.\n`);
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      }
    }

    if (!opts.apply) {
      console.log("--- Summary ---");
      let totalChanges = 0;
      for (const r of report) {
        totalChanges += r.changes.length;
        if (r.changes.length === 0) {
          console.log(`Request #${r.requestId}: no changes (already matches transfer-derived apportion).`);
        }
      }
      console.log(`\nTotal line updates proposed: ${totalChanges}`);
    }

    return report;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
