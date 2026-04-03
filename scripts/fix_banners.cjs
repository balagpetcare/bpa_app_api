const fs = require("fs");
const p = "D:/BPA_Data/bpa_web/app/staff/(larkon)/branch/[branchId]/inventory/stock-request-create/page.jsx";
let s = fs.readFileSync(p, "utf8");
const bad = `            {pickerMeta?.defaultLocationCreated && (
        <<div className="alert alert-warning py-2 mb-3" role="status">
          A default branch stock location was created so inventory can be tracked. Stock counts may show zero until receipts are posted.
        </div>
      )}
      {pickerMeta?.catalogTruncated && (
       div className="alert alert-warning py-2 mb-3" role="status">
          Product catalog is large; results are capped. Refine search to see all SKUs.
        </div>
      )}
`;
const good = `      {pickerMeta?.defaultLocationCreated && (
        <div className="alert alert-warning py-2 mb-3" role="status">
          A default branch stock location was created so inventory can be tracked. Stock counts may show zero until receipts are posted.
        </div>
      )}
      {pickerMeta?.catalogTruncated && (
        <div className="alert alert-warning py-2 mb-3" role="status">
          Product catalog is large; results are capped. Refine search to see all SKUs.
        </div>
      )}
`;
if (s.includes("<<div")) {
  s = s.replace(bad, good);
  fs.writeFileSync(p, s);
  console.log("fixed");
} else console.log("skip");
