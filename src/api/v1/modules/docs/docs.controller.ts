/**
 * Serves planning/design markdown docs for the Next.js admin panel.
 * docs/ ফোল্ডার থেকে সব প্ল্যানিং ডক পড়া হয়।
 * GET /api/v1/docs/list - list of doc slugs and titles
 * GET /api/v1/docs/:slug - raw markdown content (slug = filename without .md)
 */

const fs = require("fs");
const path = require("path");

const DOCS_DIR = path.join(process.cwd(), "docs");

/** Read docs from docs folder. */
function getDocsDir() {
  return DOCS_DIR;
}

/** Allowed slug: filename without .md; no path traversal */
function sanitizeSlug(slug: string): string | null {
  if (!slug || typeof slug !== "string") return null;
  const s = slug.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(s)) return null;
  return s;
}

/** Static list of planning docs (title for display). Add new docs here. */
const DOC_TITLES: Record<string, string> = {
  GLOBAL_READY_MASTER: "Global-Ready Master",
  GLOBAL_READY_FULL_PLANNING: "Global-Ready Full Planning (Phases 1–6)",
  GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT: "Country-Wise Design Blueprint",
  GLOBAL_READY_PRODUCT_SYSTEM: "Global-Ready Product System",
  GLOBAL_READY_REMAINING_STEPS: "Global-Ready Remaining Steps",
  COUNTRY_POLICY_ENGINE_DESIGN: "Country Policy Engine Design",
  AML_KYC_FLOW: "AML / KYC Flow",
  MVP_GLOBAL_LAUNCH_CHECKLIST: "MVP Global Launch Checklist",
  DEVELOPER_ONBOARDING_GLOBAL: "Developer Onboarding (Global)",
  GLOBAL_READY_PHASE1_APPLY: "Phase 1 Apply – Country + Policy",
  GLOBAL_READY_PHASE2_APPLY: "Phase 2 Apply – Donation + Compliance",
  GLOBAL_READY_PHASE3_APPLY: "Phase 3 Apply – Storage + Payment + Location",
  GLOBAL_READY_PHASE4_APPLY: "Phase 4 Apply – Ads + Govt + RBAC",
  GLOBAL_READY_PHASE5_APPLY: "Phase 5 Apply – Frontend + App",
  BRANCH_ACCESS_SYSTEM_BN: "Branch Access System (BN)",
  STAFF_ACCESS_WAITING_FLOW_BN: "Staff Access Waiting Flow (BN)",
  TROUBLESHOOTING_BN: "Troubleshooting (BN)",
};

/**
 * Display order: docs in this array first (in this order); any other .md files after, sorted by slug.
 * 1 = Start/onboarding → 2 = Master/overview → 3 = Phase Apply → 4 = Design/system → 5 = AML/KYC
 * → 6 = Branch/Staff → 7 = Other modules → 8 = Troubleshooting → 9 = Meta
 */
const DOC_ORDER: string[] = [
  "CURSOR_START_HERE",
  "DEVELOPER_ONBOARDING_GLOBAL",
  "QUICK_START_BN",
  "GLOBAL_READY_MASTER",
  "GLOBAL_READY_FULL_PLANNING",
  "GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT",
  "GLOBAL_READY_PHASE1_APPLY",
  "GLOBAL_READY_PHASE2_APPLY",
  "GLOBAL_READY_PHASE3_PREP",
  "GLOBAL_READY_PHASE3_APPLY",
  "GLOBAL_READY_PHASE4_APPLY",
  "GLOBAL_READY_PHASE5_APPLY",
  "GLOBAL_READY_PRODUCT_SYSTEM",
  "COUNTRY_POLICY_ENGINE_DESIGN",
  "GLOBAL_READY_REMAINING_STEPS",
  "MVP_GLOBAL_LAUNCH_CHECKLIST",
  "AML_KYC_FLOW",
  "BRANCH_ACCESS_SYSTEM_BN",
  "BRANCH_MANAGER_MODULE_MATRIX",
  "STAFF_ACCESS_WAITING_FLOW_BN",
  "FRONTEND_BRANCH_ACCESS_API",
  "FRONTEND_BRANCH_ACCESS_BN",
  "LOCATION_MODULE_SPEC",
  "PRODUCT_AUTHENTICITY_SERIAL_ISSUANCE_BLUEPRINT",
  "INVENTORY_EXPIRY_TRANSFER_BN",
  "IMPLEMENTATION_SUMMARY_BN",
  "TROUBLESHOOTING_BN",
  "ERROR_FIX_STEPS",
  "PLANNING_DOCS_IN_NEXTJS",
  "REPO_MAP",
];

async function listDocs(_req: any, res: any) {
  try {
    const slugs: { slug: string; title: string }[] = [];
    const dir = getDocsDir();
    if (!fs.existsSync(dir)) {
      const fallback = DOC_ORDER.map((slug) => ({ slug, title: DOC_TITLES[slug] || slug.replace(/_/g, " ") }));
      return res.json({ success: true, data: fallback });
    }
    const files = fs.readdirSync(dir) as string[];
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const slug = f.slice(0, -3);
      const title = DOC_TITLES[slug] || slug.replace(/_/g, " ");
      slugs.push({ slug, title });
    }
    const orderIndex = (slug: string) => {
      const i = DOC_ORDER.indexOf(slug);
      return i === -1 ? DOC_ORDER.length : i;
    };
    slugs.sort((a, b) => {
      const ia = orderIndex(a.slug);
      const ib = orderIndex(b.slug);
      return ia !== ib ? ia - ib : a.slug.localeCompare(b.slug);
    });
    return res.json({ success: true, data: slugs });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

async function getDoc(req: any, res: any) {
  try {
    const slug = sanitizeSlug(req.params.slug);
    if (!slug) return res.status(400).json({ success: false, message: "Invalid slug" });
    const dir = getDocsDir();
    const filePath = path.join(dir, `${slug}.md`);
    if (!fs.existsSync(filePath) || !path.resolve(filePath).startsWith(path.resolve(dir))) {
      return res.status(404).json({ success: false, message: "Doc not found" });
    }
    const content = fs.readFileSync(filePath, "utf8");
    return res.json({ success: true, data: { slug, title: DOC_TITLES[slug] || slug, content } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

module.exports = { listDocs, getDoc };
