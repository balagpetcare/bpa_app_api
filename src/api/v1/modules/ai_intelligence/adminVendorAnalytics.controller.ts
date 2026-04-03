export {};
const svc = require("./adminVendorAnalytics.service");

async function getSummary(_req: any, res: any) {
  try {
    const data = await svc.getVendorAnalyticsSummary();
    return res.json({ success: true, data });
  } catch (e: any) {
    console.error("adminVendorAnalytics.getSummary", e);
    return res.status(500).json({ success: false, message: e?.message || "Error" });
  }
}

module.exports = { getSummary };
