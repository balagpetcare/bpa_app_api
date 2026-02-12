# Current Implementation Audit + Gap Analysis (বাংলা)

**Repo/Branch:**  
- Backend: balagpetcare/bpa_app_api @ ver/V100.0.01.03  
- Frontend: balagpetcare/web_app @ ver/V100.0.01.03  

**Target Architecture:**  
Organization → Location (Shop/Clinic/Hybrid/Delivery Hub) → Location-wise Inventory → POS + Online Order Routing (Hub-based fulfilment) + Roles/Permissions  

---

## A) Executive Summary (বাংলা, 8–12 বুলেট)

- **Organization ও Branch (Location) মডেল সম্পূর্ণ আছে:** `Organization`, `Branch`, `BranchType`, `BranchToType`, `OrganizationType` — সব Prisma schema-তে; Owner/Admin routes ও ফ্রন্টএন্ড প্যানেলে ব্যবহার হচ্ছে।
- **Location টাইপ:** Branch-এ `capabilitiesJson`, `featuresJson` এবং `BranchToType` / `BranchTypeOnBranch` দিয়ে Shop/Clinic/Hybrid ধারণা আছে; আলাদা “Delivery Hub” টাইপ enum/মডেল নেই, শুধু `InventoryLocationType`-এ `ONLINE_HUB` আছে।
- **ইনভেন্টরি লোকেশন-ওয়াইজ আছে (দুই স্তর):** (১) পুরনো `Inventory` টেবিল branch + product + variant ভিত্তি; (২) নতুন লেজার সিস্টেম — `InventoryLocation` (branch-এর under), `StockBalance`, `StockLedger`, `StockLot`, `LocationVariantConfig`, `LocationPrice` — ব্যাচ/এক্সপায়ারি ও লোকেশন-ওয়াইজ প্রাইস সাপোর্ট করে।
- **অর্ডার মডেলে fulfilment_location_id নেই:** `Order` শুধু `branchId` ধরে; অনলাইন অর্ডার কোন হাব থেকে fulfil হবে তার জন্য আলাদা ফিল্ড/রাউটিং লজিক ডাটাবেইজে নেই।
- **POS ও অর্ডার মডিউল আংশিক:** POS sale, receipt আছে (`/pos/sale`, `/pos/products`, `/pos/receipt/:orderId`); অর্ডার create/status/payment/cancel আছে কিন্তু online vs offline separation এবং hub-based routing API/ডাটা নাই।
- **অনলাইন স্টোর ও হাব চয়েস আছে:** `/online-store/products`, `/online-store/variants/:id/availability`, `/online-store/checkout/choose-hub` — হাব সিলেকশন লজিক আছে; অর্ডার টেবিলে এই হাব লিংক নেই।
- **রোল/পারমিশন ও গার্ড:** `ownerPanelGuard`, `requireOwnerScope`, `scopePermission.service`, `ownerPanelAccess.service` দিয়ে Owner প্যানেলে Staff/Team RBAC ও effective org/branch স্কোপ করা হয়েছে; ৪০৩ এর কারণ ডকুমেন্টেড (PATCH_OWNER_PANEL_STAFF_RBAC.md, PATCH_CLONE_PRODUCTS_OWNER_TEAM.md)।
- **ক্লিনিক মডিউল:** Service (কনসালটেশন, ভ্যাকসিন ইত্যাদি) ও Branch-টাইপ CLINIC আছে; প্রেসক্রিপশন → মেডিসিন শিডিউল/রিমাইন্ডার ডাটা মডেল বা এন্ডপয়েন্ট নেই।
- **পার্টনার/অনলাইন স্টোর:** পার্টনার অনবোর্ডিং (অ্যাপ্লিকেশন, অর্গ, ব্রাঞ্চ, পাবলিশ) API আছে; ক্যাটালগ এমবেড/পাবলিক ফিড API আলাদা ডকুমেন্টেড না।
- **ওয়ালেট/ওয়েবহুক/অডিট:** User wallet, withdraw, admin payout ও payout webhooks আছে; অডিট লগ অ্যাডমিন এন্ডপয়েন্টে (`/admin/audit/logs`, `/admin/audit/diff/:id`) আছে; Owner/ব্রাঞ্চ লেভেল অডিট লগের স্পেসিফিক কন্ট্রাক্ট নাই।

---

## B) Module Status Table (বাংলা)

| মডিউল | স্টেটাস | প্রমাণ (ফাইল পাথ) |
|--------|---------|-------------------|
| **Auth / Org / Branch(Location) / Roles / Staff** | **DONE** | `backend-api/prisma/schema.prisma` (Organization, Branch, OrgMember, BranchMember, BranchMemberRole, Role, Permission, BranchAccessPermission); `backend-api/src/api/v1/modules/auth/`, `owner/owner.routes.ts`, `owner.controller.ts`; `backend-api/src/middlewares/ownerPanelGuard.ts`, `requireOwnerScope.ts`, `requireOwnerContext.ts`; `backend-api/src/api/v1/services/scopePermission.service.ts`, `ownerPanelAccess.service.ts`; `bpa_web/app/owner/` (organizations, branches, staffs, team)। |
| **Products / Categories / Brands** | **DONE** | `schema.prisma` (Product, Category, Brand, ProductVariant, MasterProductCatalog); `backend-api/src/api/v1/modules/products/products.routes.ts`, `products.controller.ts`, `master-catalog.controller.ts`; `bpa_web/app/owner/products/`, `shop/products/`। |
| **Inventory (location-wise? batch/expiry?)** | **PARTIAL** | Location-wise: `Inventory` (branchId) + `InventoryLocation` (branchId, type: CLINIC/SHOP/ONLINE_HUB), `StockBalance`, `StockLedger`, `StockLot` — `backend-api/prisma/schema.prisma`; batch/expiry: `StockLot`, `StockLedger.lotId`, `Inventory.expiryDate`; API: `inventory.routes.ts` (ledger, lots, fefo, opening, pos-sale, online-reserve/sale); `inventory.service.ts`, `ledger.service.ts`। পুরনো `Inventory` এবং নতুন ledger দুটো কো-এক্সিস্ট করছে। |
| **POS (billing, payments, returns)** | **PARTIAL** | POS: `backend-api/src/api/v1/modules/pos/pos.routes.ts` (get products, create sale, get receipt); `pos.controller.ts`। Returns: `backend-api/src/api/v1/modules/returns/`; Order payment: `orders.controller.ts` (processPayment)। পূর্ণ বিলিং/পেমেন্ট ফ্লো ও রিটার্নস প্যানেল ম্যাপিং ডকুমেন্টেড না। |
| **Orders (online/offline separation? routing?)** | **PARTIAL** | Order মডেল: `branchId` only, no `fulfilment_location_id` or `orderSource` — `schema.prisma` (Order, OrderItem)। API: `orders.routes.ts`, `orders.controller.ts` (list/get/create/status/payment/cancel)। Online-store: `online-store.controller.ts` (choose-hub) — হাব চয়েস লজিক আছে কিন্তু অর্ডার টেবিলে হাব লিংক নেই। |
| **Clinic (prescription → medicine schedule?)** | **PARTIAL** | Service মডেল ও BranchType CLINIC; `schema.prisma` (Service, BranchType)। ক্লিনিক প্যানেল: `bpa_web/app/clinic/` (appointments, patients, services, staff)। প্রেসক্রিপশন → মেডিসিন শিডিউল/রিমাইন্ডার ডাটা মডেল বা এন্ডপয়েন্ট নেই। |
| **Partner / Online-store (catalog embed / API / feed?)** | **PARTIAL** | Partner: `partner_onboarding.routes.ts` (applications, organizations, branches, publish); Online-store: `online-store.routes.ts` (products, variant availability, choose-hub)। ক্যাটালগ এমবেড/পাবলিক ফিড API স্পেসিফিক ডকুমেন্ট নেই। |
| **Wallet / Webhooks / Audit logs** | **DONE** | Wallet: `wallet.routes.ts` (me, transactions, withdraw requests, admin payout); Webhooks: `payout_webhooks.routes.ts`; Audit: `admin_audit.routes.ts` (logs, diff)। Owner/ব্রাঞ্চ স্কোপ অডিট কন্ট্রাক্ট আলাদা নাই। |

---

## C) Database & Schema Findings

- **Organization / Branch(Location) টেবিল/মডেল:** আছে। `organizations`, `branches`, `branch_to_types`, `branch_types`, `organization_types`, `branch_profile_details`, `branch_documents` — `backend-api/prisma/schema.prisma` (Organization, Branch, BranchToType, BranchType, OrganizationType ইত্যাদি)।
- **Inventory per location:** আছে। (১) `inventory` টেবিল (branchId, productId, variantId, quantity, expiryDate); (২) `inventory_locations` (branchId, type: CLINIC/SHOP/ONLINE_HUB), `stock_balances`, `stock_ledgers`, `stock_lots` — location-wise + batch।
- **Order-এ fulfilment_location_id:** নেই। `orders` টেবিলে শুধু `branch_id`; কোন `fulfilment_location_id` বা `inventory_location_id` ফিল্ড নেই।
- **Price rules / partner mappings:** Location-level price: `LocationPrice` (locationId, variantId, price, effectiveFrom/To) — `schema.prisma`; `pricing.service.ts`, `online-store.service.ts` এ ব্যবহার। পার্টনার-স্পেসিফিক প্রাইস রুল বা ম্যাপিং টেবিল নেই।
- **Missing migrations / inconsistent naming:** মাইগ্রেশন ফোল্ডারে অনেক মাইগ্রেশন (২০২৬০১১৬ থেকে ২০২৬০২০৯); `schema.prisma` মনোলিথিক এবং `schema/` স্প্লিট ফাইলগুলো (00_base, 10_core, 40_location ইত্যাদি) আলাদা; কিছু টেবিল নাম ইংরেজি (organizations, branches), BD জিও টেবিল `bd_divisions`, `bd_districts` ইত্যাদি। নaming কনসিসটেন্ট।

---

## D) Frontend Panel Findings (3100–3105)

- **প্যানেল ও পোর্ট:** mother 3100, shop 3101, clinic 3102, admin 3103, owner 3104, producer 3105 — `bpa_web/package.json` (dev:mother, dev:shop, …), `lib/authRedirect.ts`।
- **Owner (3104):** অর্গ, ব্রাঞ্চ, স্টাফ, টিম, ডেলিগেশন, প্রোডাক্ট, মাস্টার ক্যাটালগ ক্লোন, ইনভেন্টরি (ট্রান্সফার, স্টক রিকোয়েস্ট, অ্যাডজাস্টমেন্ট), অর্ডার, রিটার্নস, নোটিফিকেশন, ওয়ালেট, ভেরিফিকেশন, কেওয়াইসি, পেয়আউট — API: `/api/v1/owner/*`, `/api/v1/products/*`, `/api/v1/inventory/*`, `/api/v1/transfers/*`, `/api/v1/stock-requests/*` ইত্যাদি। `app/owner/` ও `app/owner/_lib/ownerApi.ts`।
- **Shop (3101):** POS, অর্ডার, প্রোডাক্ট, ইনভেন্টরি — `app/shop/pos/`, `app/shop/orders/`, `app/shop/products/`, `app/shop/inventory/`; API `lib/api.ts` (inventory, orders, branch-access, branches/:id/me)।
- **Clinic (3102):** অ্যাপয়েন্টমেন্ট, পেশেন্ট, সার্ভিস, স্টাফ — `app/clinic/`; প্রেসক্রিপশন/মেডিসিন শিডিউল UI বা API রেফারেন্স নেই।
- **Admin (3103):** অডিট, অর্গ, ব্রাঞ্চ, ইউজার, রোল, পারমিশন, ইনভেন্টরি, ভেরিফিকেশন ইত্যাদি — `app/admin/`; API `/api/v1/admin/*`।
- **Mother (3100) / Producer (3105):** মাদার ল্যান্ডিং ও স্টাফ রুট; প্রডিউসার অ্যাপ — প্যানেল স্ট্রাকচার আছে, API ম্যাপিং প্রজেক্টে ব্যবহার অনুযায়ী।

**Owner panel 403 / AccessDenied — root cause ও ফিক্স চেকলিস্ট:**

- **কারণ (অনুমান):** স্টাফ/টিম ইউজার যখন Owner প্যানেল ব্যবহার করে, আগে শুধু OWNER/ADMIN রোল চেক হত; তাদের effective org/branch বা delegation scope লিস্ট/ডিটেইল এন্ডপয়েন্টে ব্যবহার হত না, তাই `GET /owner/organizations`, `GET /owner/branches`, `GET /owner/staffs`, `GET /owner/requests?summary=1`, `GET /owner/notifications`, `PATCH /api/v1/products/:id` ইত্যাদিতে ৪০৩ হত।
- **ফিক্স (করা হয়েছে):**  
  - `ownerPanelGuard`: OWNER, ADMIN, STAFF, TEAM allow।  
  - `getEffectiveOrgIdsForOwnerPanel` / `getEffectiveBranchIdsForOwnerPanel` ব্যবহার করে listOrganizations, listOwnerBranchesAll, listStaffs, getOwnerRequestsInbox স্কোপ করা।  
  - Product edit: `getOrgIdForUser`-এ OwnerTeamMember path; `requireOwnerOrProductManage` এ product.update / owner.products.manage চেক।  
  - Auth/me-তে owner panel permissions merge (`getPermissionsForOwnerPanel`)।  
- **চেকলিস্ট:**  
  1. `src/middlewares/ownerPanelGuard.ts` — STAFF, TEAM অ্যালাউ করা আছে কিনা।  
  2. `src/api/v1/modules/owner/owner.controller.ts` — listOrganizations, listOwnerBranchesAll, listStaffs, getOwnerRequestsInbox এ `getEffectiveOrgIdsForOwnerPanel` / `getEffectiveBranchIdsForOwnerPanel` ব্যবহার।  
  3. `src/api/v1/modules/products/products.controller.ts` — getOrgIdForUser-এ OwnerTeamMember; products.routes.ts-এ requireOwnerOrProductManage।  
  4. `src/middleware/auth.middleware.ts` — getPermissionsForOwnerPanel merge।  
  5. `app/owner/products/[id]/edit/page.tsx` — ৪০৩/ACCESS_DENIED এ ইউজার ফ্রেন্ডলি মেসেজ।

বিবরণ: `docs/PATCH_OWNER_PANEL_STAFF_RBAC.md`, `docs/PATCH_CLONE_PRODUCTS_OWNER_TEAM.md`।

---

## E) Risks & Technical Debt

- **ডুয়াল ইনভেন্টরি মডেল:** পুরনো `Inventory` (branch-product-variant) এবং নতুন ledger (`InventoryLocation`, `StockBalance`, `StockLedger`) একসাথে; কিছু রুট legacy block (adjust/upsert 410), কিছু ledger-based। একটিতে কনভার্জ বা পরিষ্কার সীমানা না থাকলে ডাটা ও বাগ রিস্ক।
- **অর্ডার ও ফুলফিলমেন্ট ডিসকানেক্ট:** Online-store “choose-hub” আছে কিন্তু Order টেবিলে fulfilment location সেভ হয় না; হাব-বেসড ফুলফিলমেন্ট ট্র্যাক করতে স্কিমা ও API বাড়ানো দরকার।
- **কনফ্লিক্ট সম্ভাবনা:** একই রাউট প্রিফিক্সে একাধিক মাউন্ট (যেমন `router.use("/admin/country", ...)` দুইবার) — `routes.ts`; পরবর্তী মাউন্ট আগেরটাকে ওভাররাইড করতে পারে।
- **৪০৩:** স্টাফ/টিমের জন্য RBAC ও effective scope ইমপ্লিমেন্ট করা হয়েছে; নতুন এন্ডপয়েন্টে context/scope ভুলে গেলে আবার ৪০৩ হতে পারে।
- **ক্লিনিক প্রেসক্রিপশন:** ডাটা মডেল ও এন্ডপয়েন্ট না থাকায় ভবিষ্যতে বড় ফিচার এড করতে স্কিমা চেঞ্জ লাগবে।

---

## F) Recommendation: প্ল্যানের কোনটা সবচেয়ে ফিট (Hub-based vs multi-source)

- **বর্তমান অবস্থা:** Branch = লোকেশন; তার নিচে `InventoryLocation` (SHOP, CLINIC, ONLINE_HUB)। Online-store এগ্রিগেট করে ONLINE_HUB স্টক দেখায় এবং checkout-এ `choose-hub` দিয়ে হাব সিলেক্ট করা যায়। Order শুধু branchId ধরে, fulfilment location ধরা নেই।
- **Hub-based fulfilment ফিট করার কারণ:** (১) ইতিমধ্যে ONLINE_HUB টাইপ ও choose-hub লজিক আছে; (২) StockBalance/StockLedger location-wise; (৩) এক জায়গায় (হাব) থেকে অর্ডার fulfil করলে ইনভেন্টরি ও ট্র্যাকিং সহজ। Multi-source (বহু উৎস থেকে এক অর্ডার) জটিল এবং এখন অর্ডার আইটেম লেভেলে সোর্স লিংক নেই।
- **সুপারিশ:** টার্গেট আর্কিটেকচার হিসাবে **Hub-based fulfilment** নেওয়া যৌক্তিক। অর্ডার টেবিলে `fulfilment_location_id` (অথবা equivalent) যোগ করে choose-hub ফলাফল অর্ডার ক্রিয়েশনের সময় সেভ করা এবং ইনভেন্টরি ডিডাক্ট/লেজার রেফারেন্স এই location-এর সাথে লিংক করলে বর্তমান কোডবেসের সাথে সবচেয়ে কম ফ্রিকশনে মিলবে।

---

## G) Next 10 Steps (Priority order, complexity, প্যানেল/এন্ডপয়েন্ট)

| # | ধাপ | জটিলতা | যেখানে ছোঁব (প্যানেল/এন্ডপয়েন্ট/ফাইল) |
|---|-----|---------|----------------------------------------|
| 1 | Order টেবিলে fulfilment location ফিল্ড যোগ (migration + Prisma) | S | `backend-api/prisma/schema.prisma` (Order); নতুন migration। |
| 2 | Order create/update এ fulfilment_location_id সেট (incl. online-store choose-hub থেকে) | M | `backend-api/src/api/v1/modules/orders/orders.controller.ts`, `orders.service.ts`; `online-store.controller.ts` / checkout ফ্লো। |
| 3 | Inventory ledger-এ অর্ডার ফুলফিলমেন্ট রেফারেন্স (refType/refId) কনসিসটেন্ট করা | S | `backend-api/src/api/v1/modules/inventory/ledger.service.ts`, অর্ডার create/confirm ফ্লো। |
| 4 | Owner প্যানেলে অর্ডার ডিটেইলে fulfilment location দেখানো + এডিট (প্রয়োজন হলে) | S | `bpa_web/app/owner/orders/`, API GET/PATCH order। |
| 5 | Online vs offline অর্ডার সেপারেশন (orderSource বা type ফিল্ড + ফিল্টার) | M | `backend-api/prisma/schema.prisma` (Order); `orders.controller.ts`, `orders.routes.ts`; Shop/Owner অর্ডার লিস্ট UI। |
| 6 | Delivery Hub টাইপ/ক্যাপাবিলিটি রিজলিউশন (BranchType বা capabilitiesJson) | S | `backend-api/prisma/schema.prisma`; seed/Admin branch types; Owner ব্রাঞ্চ ক্রিয়েশন UI। |
| 7 | ক্লিনিক প্রেসক্রিপশন → মেডিসিন শিডিউল (ডাটা মডেল + মিনিমাল API) | L | `backend-api/prisma/schema.prisma` (নতুন মডেল); `backend-api/src/api/v1/modules/` (clinic বা services এক্সটেন্ড); `bpa_web/app/clinic/`। |
| 8 | Owner/ব্রাঞ্চ অডিট লগ কন্ট্রাক্ট ও অপশনাল এন্ডপয়েন্ট | M | `backend-api/src/api/v1/modules/admin_audit/` বা owner/audit; `bpa_web/app/owner/audit/`। |
| 9 | পুরনো Inventory vs ledger ব্যবহারের সীমানা ডকুমেন্ট ও কোডে স্পষ্ট করা (deprecation path) | M | `backend-api/docs/`, `inventory.controller.ts`, `inventory.service.ts`। |
| 10 | Partner ক্যাটালগ এমবেড/পাবলিক ফিড API স্পেক ও ইমপ্লিমেন্ট (যদি রিকোয়ার্ড হয়) | L | `backend-api/src/api/v1/modules/online-store/` বা partner; পাবলিক GET products/feed। |

---

*রিপোর্টটি কপি করে ChatGPT বা অন্য টুলে পেস্ট করে আরও বিশ্লেষণ করাতে পারবেন।*
