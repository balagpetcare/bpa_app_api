const fs = require("fs");
const p = "D:/BPA_Data/bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/stock-request-create/page.jsx";
let s = fs.readFileSync(p, "utf8");
if (!s.includes("pickerMeta")) {
  s = s.replace(
    '  const [error, setError] = useState("");',
    '  const [error, setError] = useState("");\n  const [pickerMeta, setPickerMeta] = useState(null);'
  );
}
if (!s.includes("setPickerMeta(res.meta")) {
  s = s.replace(
    "        setPagination((prev) => ({",
    "        setPickerMeta(res.meta ?? null);\n        setPagination((prev) => ({"
  );
}
s = s.replace(
  "        setItems([]);\n      })",
  "        setItems([]);\n        setPickerMeta(null);\n      })"
);
s = s.replace(
  "<th>Stock</th>\n                        <th>Batch/Expiry</th>",
  "<th>Branch</th>\n                        <th>Central</th>\n                        <th>Batch/Expiry</th>"
);
s = s.replace("colSpan={7}", "colSpan={8}");
const oldCell =
  '                                  title={`Stock: ${v.stockOnHand}`}\n' +
  "                                >\n" +
  "                                  {stockLabel(v.stockOnHand, v.lowStockThreshold)} · {v.stockOnHand}\n" +
  "                                </span>\n" +
  "                              </td>\n" +
  '                              <td className="align-middle">\n' +
  "                                {v.batchInfo ? (";
const newCell =
  '                                  title="Branch on-hand"\n' +
  "                                >\n" +
  "                                  {stockLabel(v.stockOnHand, v.lowStockThreshold)} · {v.stockOnHand}\n" +
  "                                </span>\n" +
  "                              </td>\n" +
  '                              <td className="align-middle">\n' +
  '                                <span className="small text-muted" title="Central warehouse on-hand">\n' +
  '                                  {typeof v.centralOnHand === "number" && v.centralOnHand > 0 ? v.centralOnHand : "—"}\n' +
  "                                </span>\n" +
  "                              </td>\n" +
  '                              <td className="align-middle">\n' +
  "                                {v.batchInfo ? (";
if (s.includes(oldCell)) s = s.replace(oldCell, newCell);
const banner =
  `      {pickerMeta?.defaultLocationCreated && (\n` +
  `        <div className="alert alert-warning py-2 mb-3" role="status">\n` +
  `          A default branch stock location was created so inventory can be tracked. Stock counts may show zero until receipts are posted.\n` +
  `        </div>\n` +
  `      )}\n` +
  `      {pickerMeta?.catalogTruncated && (\n` +
  `       div className="alert alert-warning py-2 mb-3" role="status">\n` +
  `          Product catalog is large; results are capped. Refine search to see all SKUs.\n` +
  `        </div>\n` +
  `      )}\n`;
if (!s.includes("defaultLocationCreated")) {
  s = s.replace("{error && (", banner.replace("div className", '<div className') + "{error && (");
}
fs.writeFileSync(p, s);
console.log("patched page");
