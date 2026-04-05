/**
 * HTML print documents for GRN, dispatch challan, branch receive confirmation, discrepancy reports.
 * A4-friendly; browser print via window.print() on preview pages.
 */
import prisma from "../../../../infrastructure/db/prismaClient";

function escapeHtml(s: string | null | undefined): string {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return String(n);
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  try {
    const x = typeof d === "string" ? new Date(d) : d;
    return x.toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, Segoe UI, Roboto, Arial, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 16px; max-width: 210mm; margin-left: auto; margin-right: auto; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  h2 { font-size: 14px; margin: 16px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .meta { margin-bottom: 12px; line-height: 1.5; }
  .meta strong { display: inline-block; min-width: 120px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; font-weight: 600; }
  .num { text-align: right; }
  .sig { margin-top: 32px; display: flex; gap: 24px; flex-wrap: wrap; }
  .sigbox { flex: 1; min-width: 140px; border-top: 1px solid #333; padding-top: 6px; margin-top: 40px; }
  @media print {
    body { padding: 12mm; }
    .no-print { display: none !important; }
  }
`;

function wrapDoc(title: string, inner: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${inner}</body></html>`;
}

function grnStatusWatermark(grn: any): { label: string; color: string } {
  const sess = grn.vendorReceiveSession;
  if (grn.status === "RECEIVED") return { label: "CONFIRMED RECEIPT — GOODS RECEIVED NOTE", color: "#1a7a3a" };
  if (sess?.status === "AWAITING_CONFIRMATION") return { label: "PENDING CONFIRMATION", color: "#b45309" };
  if (grn.status === "VOIDED") return { label: "VOIDED", color: "#991b1b" };
  return { label: "DRAFT", color: "#4b5563" };
}

export async function renderGrnPrintHtml(grnId: number, orgId: number): Promise<string> {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    include: {
      org: { select: { name: true } },
      vendor: { select: { name: true, phone: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      location: { include: { branch: { select: { name: true } } } },
      receivedBy: { include: { profile: { select: { displayName: true } } } },
      vendorReceiveSession: {
        select: {
          status: true,
          submittedAt: true,
          confirmedAt: true,
          confirmedByUserId: true,
          confirmedBy: { select: { profile: { select: { displayName: true } } } },
        },
      },
      lines: {
        include: {
          variant: { select: { sku: true, title: true } },
          lot: { select: { lotCode: true, expDate: true, mfgDate: true } },
          purchaseOrderLine: { select: { orderedQty: true } },
        },
      },
    },
  });
  if (!grn) throw new Error("GRN not found");

  const wm = grnStatusWatermark(grn);
  const sess = (grn as any).vendorReceiveSession;
  const confirmedByName = sess?.confirmedBy?.profile?.displayName
    ?? (sess?.confirmedByUserId ? `User #${sess.confirmedByUserId}` : null);

  const title = `GRN #${grn.id} — ${wm.label}`;
  const rows = grn.lines
    .map((l) => {
      const ordered = l.purchaseOrderLine?.orderedQty;
      const stockAdded = Number(l.quantity ?? 0) + Number((l as any).quantityExtra ?? 0);
      return `<tr>
        <td>${escapeHtml(l.variant.sku)}</td>
        <td>${escapeHtml(l.variant.title)}</td>
        <td class="num">${fmtQty(ordered as number)}</td>
        <td class="num">${fmtQty(l.quantity)}</td>
        <td class="num">${fmtQty(l.quantityDamaged)}</td>
        <td class="num">${fmtQty(l.quantityShort)}</td>
        <td class="num">${fmtQty((l as any).quantityExtra ?? 0)}</td>
        <td class="num">${fmtQty(stockAdded)}</td>
        <td>${escapeHtml(l.lot?.lotCode ?? (l as any).lotCode ?? "—")}</td>
        <td>${fmtDate(l.expDate ?? l.lot?.expDate)}</td>
        <td>${escapeHtml((l as any).lineDiscrepancyNote ?? "—")}</td>
      </tr>`;
    })
    .join("");

  const inner = `
    <div style="border:3px solid ${wm.color};padding:6px 12px;margin-bottom:12px;text-align:center;font-size:14px;font-weight:700;color:${wm.color};letter-spacing:1px;">
      ${escapeHtml(wm.label)}
    </div>
    <h1 style="margin-top:0">Goods Received Note — GRN #${grn.id}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(grn.org?.name ?? "—")}</div>
      <div><strong>Warehouse / Location</strong> ${escapeHtml(grn.location?.name ?? "—")} ${grn.location?.branch?.name ? `(${escapeHtml(grn.location.branch.name)})` : ""}</div>
      <div><strong>Vendor</strong> ${escapeHtml(grn.vendor?.name ?? "—")}${grn.vendor?.phone ? ` — ${escapeHtml(grn.vendor.phone)}` : ""}</div>
      <div><strong>Purchase order</strong> ${grn.purchaseOrder ? escapeHtml(grn.purchaseOrder.poNumber) : "—"}</div>
      <div><strong>Invoice no.</strong> ${escapeHtml(grn.invoiceNo ?? "—")}</div>
      <div><strong>Invoice date</strong> ${fmtDate(grn.invoiceDate)}</div>
      <div><strong>GRN created</strong> ${fmtDate(grn.createdAt)}</div>
      <div><strong>Received / confirmed at</strong> ${fmtDate(grn.receivedAt ?? sess?.confirmedAt)}</div>
      <div><strong>Confirmed by</strong> ${escapeHtml(confirmedByName ?? grn.receivedBy?.profile?.displayName ?? "—")}</div>
      ${grn.notes ? `<div><strong>Notes</strong> ${escapeHtml(grn.notes)}</div>` : ""}
    </div>
    <h2>Received lines</h2>
    <table>
      <thead>
        <tr>
          <th>SKU</th><th>Product</th>
          <th class="num">Expected</th>
          <th class="num">Accepted</th>
          <th class="num">Damaged</th>
          <th class="num">Short</th>
          <th class="num">Extra</th>
          <th class="num">Stock posted</th>
          <th>Batch / lot</th><th>Expiry</th><th>Note</th>
        </tr>
      </thead>
      <tbody>${rows || "<tr><td colspan='11'>No lines</td></tr>"}</tbody>
    </table>
    <p style="font-size:11px;color:#555;margin-top:6px">
      Stock posted = Accepted + Extra. Damaged excluded from stock. Short recorded as discrepancy.
    </p>
    <div class="sig">
      <div class="sigbox">Vendor representative<br/><span style="font-size:10px;color:#888">Name &amp; signature</span></div>
      <div class="sigbox">Warehouse receiving officer<br/><span style="font-size:10px;color:#888">Name &amp; signature</span></div>
      <div class="sigbox">Warehouse manager / Approver<br/><span style="font-size:10px;color:#888">Name &amp; signature</span></div>
      <div class="sigbox">Security / Gate check-off<br/><span style="font-size:10px;color:#888">Name &amp; signature (optional)</span></div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderGrnWorksheetHtml(grnId: number, orgId: number): Promise<string> {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    include: {
      org: { select: { name: true } },
      vendor: { select: { name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      location: { include: { branch: { select: { name: true } } } },
      vendorReceiveSession: { select: { status: true } },
      lines: {
        include: {
          variant: { select: { sku: true, title: true, barcode: true } },
          lot: { select: { lotCode: true, expDate: true, mfgDate: true } },
          purchaseOrderLine: { select: { orderedQty: true } },
        },
      },
    },
  });
  if (!grn) throw new Error("GRN not found");

  const wm = grnStatusWatermark(grn);
  const title = `Receive worksheet — GRN #${grn.id}`;
  const rows = grn.lines
    .map((l) => {
      const ordered = l.purchaseOrderLine?.orderedQty;
      return `<tr>
        <td>${escapeHtml(l.variant.sku)}</td>
        <td>${escapeHtml(l.variant.title)}</td>
        <td>${escapeHtml((l.variant as any).barcode ?? "—")}</td>
        <td class="num">${fmtQty(ordered as number)}</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td>${escapeHtml(l.lot?.lotCode ?? (l as any).lotCode ?? "")}</td>
        <td>${fmtDate(l.expDate ?? l.lot?.expDate)}</td>
        <td></td>
      </tr>`;
    })
    .join("");

  const inner = `
    <div style="border:2px solid ${wm.color};padding:4px 10px;margin-bottom:10px;text-align:center;font-size:13px;font-weight:700;color:${wm.color};">
      ${escapeHtml(wm.label)} — PHYSICAL COUNT WORKSHEET
    </div>
    <h1 style="margin-top:0">GRN receive worksheet — GRN #${grn.id}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(grn.org?.name ?? "—")}</div>
      <div><strong>Vendor</strong> ${escapeHtml(grn.vendor?.name ?? "—")}</div>
      <div><strong>Purchase order</strong> ${grn.purchaseOrder ? escapeHtml(grn.purchaseOrder.poNumber) : "—"}</div>
      <div><strong>Location</strong> ${escapeHtml(grn.location?.name ?? "—")} ${grn.location?.branch?.name ? `(${escapeHtml(grn.location.branch.name)})` : ""}</div>
      <div><strong>Invoice no.</strong> _______________</div>
      <div><strong>Delivery date</strong> _______________</div>
      <div><strong>Delivery vehicle / challan</strong> _______________</div>
    </div>
    <h2>Physical verification</h2>
    <table style="font-size:11px">
      <thead>
        <tr>
          <th>SKU</th><th>Product</th><th>Barcode</th>
          <th class="num">Expected</th>
          <th class="num">Physical count</th>
          <th class="num">Accepted</th>
          <th class="num">Damaged</th>
          <th class="num">Short / Extra</th>
          <th>Batch / lot</th><th>Expiry</th><th>Remarks</th>
        </tr>
      </thead>
      <tbody>${rows || "<tr><td colspan='11'>No lines</td></tr>"}</tbody>
    </table>
    <div class="sig">
      <div class="sigbox">Receiving staff<br/><span style="font-size:10px;color:#888">Name &amp; signature</span></div>
      <div class="sigbox">Warehouse manager confirmation<br/><span style="font-size:10px;color:#888">Name &amp; signature</span></div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderGrnDiscrepancyReportHtml(grnId: number, orgId: number): Promise<string> {
  const grn = await prisma.grn.findFirst({
    where: { id: grnId, orgId },
    include: {
      org: { select: { name: true } },
      vendor: { select: { name: true } },
      location: { include: { branch: { select: { name: true } } } },
      lines: {
        include: {
          variant: { select: { sku: true, title: true } },
          lot: { select: { lotCode: true, expDate: true } },
        },
      },
      inboundDiscrepancies: {
        include: {
          variant: { select: { sku: true, title: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!grn) throw new Error("GRN not found");

  const discRows = grn.inboundDiscrepancies.length
    ? grn.inboundDiscrepancies
        .map(
          (d) => `<tr>
      <td>${escapeHtml(d.variant.sku)}</td>
      <td>${escapeHtml(d.variant.title)}</td>
      <td>${escapeHtml(d.discrepancyType)}</td>
      <td class="num">${fmtQty(d.quantity)}</td>
      <td>${escapeHtml(d.reasonCode ?? "—")}</td>
      <td>${escapeHtml(d.notes ?? "—")}</td>
      <td>${escapeHtml(d.status)}</td>
    </tr>`
        )
        .join("")
    : grn.lines
        .filter((l) => l.quantityDamaged > 0 || l.quantityShort > 0 || (l.quantityExtra ?? 0) > 0)
        .map((l) => {
          const parts: string[] = [];
          if (l.quantityDamaged > 0) parts.push(`Damaged ${l.quantityDamaged}`);
          if (l.quantityShort > 0) parts.push(`Short ${l.quantityShort}`);
          if ((l.quantityExtra ?? 0) > 0) parts.push(`Extra ${l.quantityExtra}`);
          return `<tr>
        <td>${escapeHtml(l.variant.sku)}</td>
        <td>${escapeHtml(l.variant.title)}</td>
        <td>LINE_SUMMARY</td>
        <td class="num">—</td>
        <td>—</td>
        <td>${escapeHtml(parts.join("; ") + (l.lineDiscrepancyNote ? ` — ${l.lineDiscrepancyNote}` : ""))}</td>
        <td>—</td>
      </tr>`;
        })
        .join("");

  const wmDisc = grnStatusWatermark(grn);
  const title = `Discrepancy report — GRN #${grn.id}`;
  const inner = `
    <div style="border:2px solid ${wmDisc.color};padding:4px 10px;margin-bottom:10px;text-align:center;font-size:13px;font-weight:700;color:${wmDisc.color};">
      ${escapeHtml(wmDisc.label)} — DISCREPANCY REPORT
    </div>
    <h1 style="margin-top:0">${escapeHtml(title)}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(grn.org?.name ?? "—")}</div>
      <div><strong>Location</strong> ${escapeHtml(grn.location?.name ?? "—")}</div>
      <div><strong>Vendor</strong> ${escapeHtml(grn.vendor?.name ?? "—")}</div>
      <div><strong>GRN status</strong> ${escapeHtml(grn.status)}</div>
      <div><strong>GRN created</strong> ${fmtDate(grn.createdAt)}</div>
    </div>
    <h2>Recorded discrepancies</h2>
    <table>
      <thead>
        <tr>
          <th>SKU</th><th>Product</th><th>Type</th><th class="num">Qty</th><th>Reason code</th><th>Notes</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${discRows || "<tr><td colspan='7'>No discrepancies recorded</td></tr>"}</tbody>
    </table>
    <div class="sig">
      <div class="sigbox">Reported by<br/><span style="font-size:10px;color:#888">Name &amp; signature</span></div>
      <div class="sigbox">Vendor representative<br/><span style="font-size:10px;color:#888">Name &amp; signature</span></div>
      <div class="sigbox">Warehouse manager reviewed<br/><span style="font-size:10px;color:#888">Name &amp; signature</span></div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderDispatchChallanHtml(dispatchId: number, orgId: number): Promise<string> {
  const d = await prisma.stockDispatch.findFirst({
    where: { id: dispatchId, orgId },
    include: {
      org: { select: { name: true } },
      fromLocation: { include: { branch: { select: { name: true } } } },
      toLocation: { include: { branch: { select: { name: true } } } },
      items: {
        include: {
          variant: { select: { sku: true, title: true } },
          lot: { select: { lotCode: true, expDate: true } },
        },
      },
    },
  });
  if (!d) throw new Error("Dispatch not found");

  const title = `Dispatch challan #${d.id}`;
  const rows = d.items
    .map(
      (it) => `<tr>
    <td>${escapeHtml(it.variant.sku)}</td>
    <td>${escapeHtml(it.variant.title)}</td>
    <td class="num">${fmtQty(it.quantityDispatched)}</td>
    <td>${escapeHtml(it.lot?.lotCode ?? "—")}</td>
    <td>${fmtDate(it.lot?.expDate)}</td>
  </tr>`
    )
    .join("");

  const inner = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(d.org?.name ?? "—")}</div>
      <div><strong>From (source)</strong> ${escapeHtml(d.fromLocation?.name ?? "—")} ${d.fromLocation?.branch?.name ? `— ${escapeHtml(d.fromLocation.branch.name)}` : ""}</div>
      <div><strong>To (destination)</strong> ${escapeHtml(d.toLocation?.name ?? "—")} ${d.toLocation?.branch?.name ? `— ${escapeHtml(d.toLocation.branch.name)}` : ""}</div>
      <div><strong>Status</strong> ${escapeHtml(d.status)}</div>
      <div><strong>Created</strong> ${fmtDate(d.createdAt)}</div>
      ${d.note ? `<div><strong>Note</strong> ${escapeHtml(d.note)}</div>` : ""}
      ${d.vehicleNo ? `<div><strong>Vehicle</strong> ${escapeHtml(d.vehicleNo)}</div>` : ""}
      ${d.driverName ? `<div><strong>Driver</strong> ${escapeHtml(d.driverName)}</div>` : ""}
    </div>
    <h2>Lines (dispatched)</h2>
    <table>
      <thead>
        <tr><th>SKU</th><th>Product</th><th class="num">Qty sent</th><th>Batch / lot</th><th>Expiry</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="sig">
      <div class="sigbox">Dispatched by</div>
      <div class="sigbox">Driver / Carrier</div>
      <div class="sigbox">Received at destination (name & date)</div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderBranchReceiveConfirmationHtml(dispatchId: number, orgId: number): Promise<string> {
  const d = await prisma.stockDispatch.findFirst({
    where: { id: dispatchId, orgId },
    include: {
      org: { select: { name: true } },
      fromLocation: { include: { branch: { select: { name: true } } } },
      toLocation: { include: { branch: { select: { name: true } } } },
      grns: { orderBy: { id: "desc" }, take: 1, include: { receivedBy: { include: { profile: { select: { displayName: true } } } } } },
      dispatchReceiveSession: {
        include: {
          lines: {
            include: {
              stockDispatchItem: {
                include: {
                  variant: { select: { sku: true, title: true } },
                  lot: { select: { lotCode: true, expDate: true } },
                },
              },
            },
          },
        },
      },
      items: {
        include: {
          variant: { select: { sku: true, title: true } },
          lot: { select: { lotCode: true, expDate: true } },
        },
      },
    },
  });
  if (!d) throw new Error("Dispatch not found");

  const grn = d.grns[0];
  const sess = d.dispatchReceiveSession;

  const rows = d.items
    .map((it) => {
      const sessLine = sess?.lines?.find((l) => l.stockDispatchItemId === it.id);
      const good = it.quantityReceived;
      const dam = it.quantityDamaged;
      const sh = it.quantityShort;
      const extra = Math.max(0, good + dam + sh - it.quantityDispatched);
      return `<tr>
      <td>${escapeHtml(it.variant.sku)}</td>
      <td>${escapeHtml(it.variant.title)}</td>
      <td class="num">${fmtQty(it.quantityDispatched)}</td>
      <td class="num">${fmtQty(good)}</td>
      <td class="num">${fmtQty(dam)}</td>
      <td class="num">${fmtQty(sh)}</td>
      <td class="num">${extra > 0 ? fmtQty(extra) : "0"}</td>
      <td>${escapeHtml(it.lot?.lotCode ?? "—")}</td>
      <td>${fmtDate(it.lot?.expDate)}</td>
      <td>${sessLine ? escapeHtml(sessLine.reasonCode ?? "—") : "—"}</td>
    </tr>`;
    })
    .join("");

  const title = `Branch receive confirmation — Dispatch #${d.id}`;
  const inner = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(d.org?.name ?? "—")}</div>
      <div><strong>Source</strong> ${escapeHtml(d.fromLocation?.name ?? "—")}</div>
      <div><strong>Destination</strong> ${escapeHtml(d.toLocation?.name ?? "—")} (${escapeHtml(d.toLocation?.branch?.name ?? "—")})</div>
      <div><strong>Dispatch status</strong> ${escapeHtml(d.status)}</div>
      ${grn ? `<div><strong>Transfer GRN</strong> #${grn.id} — ${fmtDate(grn.receivedAt)} — ${escapeHtml(grn.receivedBy?.profile?.displayName ?? "")}</div>` : ""}
      ${sess ? `<div><strong>Receive session</strong> ${escapeHtml(sess.status)} ${sess.confirmedAt ? `— confirmed ${fmtDate(sess.confirmedAt)}` : ""}</div>` : ""}
    </div>
    <h2>Quantities (cumulative on dispatch lines)</h2>
    <table>
      <thead>
        <tr>
          <th>SKU</th><th>Product</th><th class="num">Sent</th><th class="num">Accepted</th><th class="num">Damaged</th><th class="num">Short</th><th class="num">Extra*</th>
          <th>Batch</th><th>Expiry</th><th>Reason</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:11px;color:#555">*Extra = accepted + damaged + short − sent (informational)</p>
    <div class="sig">
      <div class="sigbox">Branch staff (verified)</div>
      <div class="sigbox">Branch manager (confirmed)</div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderPurchaseOrderPrintHtml(poId: number, orgId: number): Promise<string> {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, orgId },
    include: {
      org: { select: { name: true } },
      vendor: { select: { name: true, phone: true } },
      warehouse: { select: { name: true } },
      lines: {
        include: {
          variant: { select: { sku: true, title: true, barcode: true } },
        },
      },
    },
  });
  if (!po) throw new Error("Purchase order not found");

  const title = `Purchase Order — ${escapeHtml(po.poNumber ?? `#${po.id}`)}`;
  const rows = po.lines
    .map(
      (l) => `<tr>
    <td>${escapeHtml(l.variant?.sku)}</td>
    <td>${escapeHtml(l.variant?.title)}</td>
    <td class="num">${fmtQty(l.orderedQty)}</td>
    <td class="num">${l.unitCost != null ? Number(l.unitCost).toFixed(2) : "—"}</td>
    <td class="num">${l.orderedQty != null && l.unitCost != null ? (Number(l.orderedQty) * Number(l.unitCost)).toFixed(2) : "—"}</td>
    <td class="num">${fmtQty(l.receivedQty ?? 0)}</td>
  </tr>`
    )
    .join("");

  const inner = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(po.org?.name ?? "—")}</div>
      <div><strong>PO number</strong> ${escapeHtml(po.poNumber ?? "—")}</div>
      <div><strong>Status</strong> ${escapeHtml(po.status)}</div>
      <div><strong>Vendor</strong> ${escapeHtml(po.vendor?.name ?? "—")}${po.vendor?.phone ? ` — ${escapeHtml(po.vendor.phone)}` : ""}</div>
      ${po.warehouse ? `<div><strong>Warehouse</strong> ${escapeHtml(po.warehouse.name)}</div>` : ""}
      <div><strong>Expected delivery</strong> ${fmtDate(po.expectedDeliveryDate)}</div>
      <div><strong>Created</strong> ${fmtDate(po.createdAt)}</div>
      ${po.notes ? `<div><strong>Notes</strong> ${escapeHtml(po.notes)}</div>` : ""}
    </div>
    <h2>Order lines</h2>
    <table>
      <thead>
        <tr><th>SKU</th><th>Product</th><th class="num">Ordered</th><th class="num">Unit cost</th><th class="num">Line total</th><th class="num">Received</th></tr>
      </thead>
      <tbody>${rows || "<tr><td colspan='6'>No lines</td></tr>"}</tbody>
    </table>
    <div class="sig">
      <div class="sigbox">Created by</div>
      <div class="sigbox">Approved by</div>
      <div class="sigbox">Vendor acknowledgment</div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderSupplierReceiveWorksheetHtml(poId: number, orgId: number): Promise<string> {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, orgId },
    include: {
      org: { select: { name: true } },
      vendor: { select: { name: true } },
      warehouse: { select: { name: true } },
      lines: {
        include: {
          variant: { select: { sku: true, title: true, barcode: true } },
        },
      },
    },
  });
  if (!po) throw new Error("Purchase order not found");

  const title = `Supplier receive worksheet — PO ${escapeHtml(po.poNumber ?? `#${po.id}`)}`;
  const rows = po.lines
    .map(
      (l) => `<tr>
    <td>${escapeHtml(l.variant?.sku)}</td>
    <td>${escapeHtml(l.variant?.title)}</td>
    <td>${escapeHtml(l.variant?.barcode ?? "—")}</td>
    <td class="num">${fmtQty(l.orderedQty)}</td>
    <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
  </tr>`
    )
    .join("");

  const inner = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(po.org?.name ?? "—")}</div>
      <div><strong>Vendor</strong> ${escapeHtml(po.vendor?.name ?? "—")}</div>
      ${po.warehouse ? `<div><strong>Warehouse</strong> ${escapeHtml(po.warehouse.name)}</div>` : ""}
      <div><strong>Invoice no.</strong> _______________</div>
      <div><strong>Invoice date</strong> _______________</div>
      <div><strong>Challan / ref</strong> _______________</div>
      <div><strong>Delivery date</strong> _______________</div>
    </div>
    <h2>Physical verification</h2>
    <table style="font-size:11px">
      <thead>
        <tr>
          <th>SKU</th><th>Product</th><th>Barcode</th><th class="num">Ordered</th>
          <th class="num">Invoice qty</th><th class="num">Counted</th><th class="num">Accepted</th>
          <th class="num">Damaged</th><th class="num">Short</th><th class="num">Extra</th>
          <th>Batch / lot</th><th>Expiry</th><th>Remarks</th>
        </tr>
      </thead>
      <tbody>${rows || "<tr><td colspan='13'>No lines</td></tr>"}</tbody>
    </table>
    <div class="sig">
      <div class="sigbox">Receiving staff</div>
      <div class="sigbox">Warehouse manager confirmation</div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderBranchReceiveWorksheetHtml(dispatchId: number, orgId: number): Promise<string> {
  const d = await prisma.stockDispatch.findFirst({
    where: { id: dispatchId, orgId },
    include: {
      org: { select: { name: true } },
      fromLocation: { include: { branch: { select: { name: true } } } },
      toLocation: { include: { branch: { select: { name: true } } } },
      items: {
        include: {
          variant: { select: { sku: true, title: true, barcode: true } },
          lot: { select: { lotCode: true, expDate: true } },
        },
      },
    },
  });
  if (!d) throw new Error("Dispatch not found");

  const title = `Branch receive worksheet — Dispatch #${d.id}`;
  const rows = d.items
    .map(
      (it) => `<tr>
    <td>${escapeHtml(it.variant.sku)}</td>
    <td>${escapeHtml(it.variant.title)}</td>
    <td>${escapeHtml(it.lot?.lotCode ?? "—")}</td>
    <td>${fmtDate(it.lot?.expDate)}</td>
    <td class="num">${fmtQty(it.quantityDispatched)}</td>
    <td></td><td></td><td></td><td></td><td></td><td></td>
  </tr>`
    )
    .join("");

  const inner = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(d.org?.name ?? "—")}</div>
      <div><strong>Source</strong> ${escapeHtml(d.fromLocation?.name ?? "—")} ${d.fromLocation?.branch?.name ? `(${escapeHtml(d.fromLocation.branch.name)})` : ""}</div>
      <div><strong>Destination</strong> ${escapeHtml(d.toLocation?.name ?? "—")} (${escapeHtml(d.toLocation?.branch?.name ?? "—")})</div>
      <div><strong>Dispatch status</strong> ${escapeHtml(d.status)}</div>
      <div><strong>Sent at</strong> ${fmtDate(d.inTransitAt)}</div>
    </div>
    <h2>Physical verification</h2>
    <table style="font-size:11px">
      <thead>
        <tr>
          <th>SKU</th><th>Product</th><th>Batch</th><th>Expiry</th>
          <th class="num">Expected (sent)</th><th class="num">Actual count</th><th class="num">Accepted</th>
          <th class="num">Damaged</th><th class="num">Missing</th><th class="num">Extra</th><th>Note</th>
        </tr>
      </thead>
      <tbody>${rows || "<tr><td colspan='11'>No lines</td></tr>"}</tbody>
    </table>
    <div class="sig">
      <div class="sigbox">Branch staff (verified)</div>
      <div class="sigbox">Branch manager (confirmed)</div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderPickListPrintHtml(pickListId: number, orgId: number): Promise<string> {
  const pl = await prisma.pickList.findFirst({
    where: { id: pickListId, orgId },
    include: {
      org: { select: { name: true } },
      fromLocation: { include: { branch: { select: { name: true } } } },
      assignedPicker: { include: { profile: { select: { displayName: true } } } },
      lines: {
        include: {
          variant: { select: { sku: true, title: true, barcode: true } },
          lot: { select: { lotCode: true, expDate: true } },
          location: { select: { name: true, code: true } },
        },
      },
    },
  });
  if (!pl) throw new Error("Pick list not found");

  const title = `Pick list #${pl.id}`;
  const rows = pl.lines
    .map(
      (l: any) => `<tr>
    <td>${escapeHtml(l.variant?.sku)}</td>
    <td>${escapeHtml(l.variant?.title)}</td>
    <td>${escapeHtml(l.location?.name ?? l.location?.code ?? "—")}</td>
    <td>${escapeHtml(l.lot?.lotCode ?? "—")}</td>
    <td>${fmtDate(l.lot?.expDate)}</td>
    <td class="num">${fmtQty(l.quantityToPick)}</td>
    <td class="num">${fmtQty(l.quantityPicked)}</td>
    <td></td>
  </tr>`
    )
    .join("");

  const inner = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(pl.org?.name ?? "—")}</div>
      <div><strong>Source location</strong> ${escapeHtml(pl.fromLocation?.name ?? "—")} ${pl.fromLocation?.branch?.name ? `(${escapeHtml(pl.fromLocation.branch.name)})` : ""}</div>
      <div><strong>Picker</strong> ${escapeHtml(pl.assignedPicker?.profile?.displayName ?? "—")}</div>
      <div><strong>Status</strong> ${escapeHtml(pl.status)}</div>
      <div><strong>Created</strong> ${fmtDate(pl.createdAt)}</div>
    </div>
    <h2>Pick lines</h2>
    <table>
      <thead>
        <tr><th>SKU</th><th>Product</th><th>Location / bin</th><th>Batch</th><th>Expiry</th><th class="num">To pick</th><th class="num">Picked</th><th>Check</th></tr>
      </thead>
      <tbody>${rows || "<tr><td colspan='8'>No lines</td></tr>"}</tbody>
    </table>
    <div class="sig">
      <div class="sigbox">Picker</div>
      <div class="sigbox">Checked by</div>
    </div>
  `;
  return wrapDoc(title, inner);
}

export async function renderDispatchDiscrepancyReportHtml(dispatchId: number, orgId: number): Promise<string> {
  const d = await prisma.stockDispatch.findFirst({
    where: { id: dispatchId, orgId },
    include: {
      org: { select: { name: true } },
      fromLocation: { select: { name: true } },
      toLocation: { include: { branch: { select: { name: true } } } },
      dispatchDiscrepancies: {
        include: { variant: { select: { sku: true, title: true } }, lot: { select: { lotCode: true } } },
        orderBy: { id: "desc" },
      },
    },
  });
  if (!d) throw new Error("Dispatch not found");

  const rows = d.dispatchDiscrepancies.length
    ? d.dispatchDiscrepancies
        .map(
          (x) => `<tr>
      <td>${escapeHtml(x.variant.sku)}</td>
      <td>${escapeHtml(x.variant.title)}</td>
      <td>${escapeHtml(x.reasonCode)}</td>
      <td class="num">${fmtQty(x.quantity)}</td>
      <td>${escapeHtml(x.lot?.lotCode ?? "—")}</td>
      <td>${escapeHtml(x.notes ?? "—")}</td>
      <td>${escapeHtml(x.status)}</td>
    </tr>`
        )
        .join("")
    : "<tr><td colspan='7'>No discrepancy records</td></tr>";

  const title = `Dispatch discrepancy report #${d.id}`;
  const inner = `
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <div><strong>Organization</strong> ${escapeHtml(d.org?.name ?? "—")}</div>
      <div><strong>From</strong> ${escapeHtml(d.fromLocation?.name ?? "—")}</div>
      <div><strong>To</strong> ${escapeHtml(d.toLocation?.name ?? "—")} (${escapeHtml(d.toLocation?.branch?.name ?? "")})</div>
    </div>
    <h2>Discrepancy records</h2>
    <table>
      <thead>
        <tr><th>SKU</th><th>Product</th><th>Reason</th><th class="num">Qty</th><th>Lot</th><th>Notes</th><th>Status</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="sig"><div class="sigbox">Reviewed by</div></div>
  `;
  return wrapDoc(title, inner);
}
