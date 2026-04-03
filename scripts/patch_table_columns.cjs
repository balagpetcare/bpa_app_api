const fs = require("fs");
const p = "D:/BPA_Data/bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/stock-request-create/page.jsx";
let s = fs.readFileSync(p, "utf8");
const theadOld = `<th>Stock</th>
                        <th>Batch/Expiry</th>`;
const theadNew = `<th>Branch</th>
                        <th>Central</th>
                        <th>Batch/Expiry</th>`;
if (s.includes(theadOld)) s = s.replace(theadOld, theadNew);
const rowOld = `                              </td>
                              <td className="align-middle">
                                {v.batchInfo ? (`;
const rowNew = `                              </td>
                              <td className="align-middle">
                                <span className="small text-muted" title="Central warehouse on-hand">
                                  {typeof v.centralOnHand === "number" && v.centralOnHand > 0 ? v.centralOnHand : "—"}
                                </span>
                              </td>
                              <td className="align-middle">
                                {v.batchInfo ? (`;
if (s.includes(rowOld) && !s.includes("centralOnHand")) s = s.replace(rowOld, rowNew);
s = s.replace(
  "title={`Stock: ${v.stockOnHand}`}",
  'title="Branch on-hand"'
);
fs.writeFileSync(p, s);
console.log("table patched", s.includes("centralOnHand"));
