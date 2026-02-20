# Hub-based Fulfilment + Location-based POS — ইমপ্লিমেন্টেশন প্যাচ সারাংশ (বাংলা)

নিচে শুধু **পরিবর্তিত অংশের** ডিফ-স্টাইল সারাংশ ও চেকলিস্ট দেওয়া হয়েছে। প্রতিটি পরিবর্তনের পাশে **কেন** (কারণ) লিখেছি।

---

## PHASE 1 — BACKEND

### A) Prisma / Migration

**ফাইল: `backend-api/prisma/schema.prisma`**

- **যোগ:** `enum OrderSource { ONLINE, POS, CLINIC, OTHER }`  
  **কেন:** অর্ডার সোর্স (অনলাইন/পিওএস/ক্লিনিক) ট্র্যাক ও ফিল্টার করার জন্য।

- **Order মডেলে যোগ:**  
  `fulfilmentInventoryLocationId Int?`, `orderSource OrderSource?`,  
  `fulfilmentInventoryLocation InventoryLocation? @relation("OrderFulfilmentLocation", ...)`,  
  `@@index([fulfilmentInventoryLocationId])`, `@@index([orderSource])`  
  **কেন:** কোন লোকেশন থেকে fulfil হয়েছে ও সোর্স কী তা ডিবিতে রাখতে।

- **InventoryLocation মডেলে যোগ:** `ordersFulfilled Order[] @relation("OrderFulfilmentLocation")`  
  **কেন:** অর্ডার থেকে লোকেশনে রিভার্স রিলেশন।

- **StockLedgerType enum-এ যোগ:** `SALE_CLINIC`  
  **কেন:** ক্লিনিক মেডিসিন সেলের লেজার টাইপ আলাদা রাখতে।

**ফাইল: `backend-api/prisma/migrations/20260210120000_add_order_fulfilment_location_and_source/migration.sql`** (নতুন)

- **কেন:** OrderSource enum, orders টেবিলে নতুন কলাম, FK, ইন্ডেক্স ও SALE_CLINIC যুক্ত করার মাইগ্রেশন।

---

### B) Online-store choose-hub

- **কোনো কোড পরিবর্তন নেই।**  
  **কেন:** `online-store.service.ts` ইতিমধ্যে `hubId: hub.id` (InventoryLocation.id) রিটার্ন করে; ডক অনুযায়ী এটাই কন্ট্রাক্ট।

---

### C) Orders create/update + validation + response

**ফাইল: `backend-api/src/api/v1/modules/orders/orders.service.ts`**

- **getOrders:** `options.fulfilmentInventoryLocationId` যোগ; `include.fulfilmentInventoryLocation` (id, name, code, type, branch)।  
  **কেন:** হাব দিয়ে ফিল্টার ও লিস্টে fulfilment location দেখাতে।

- **getOrderById:** `include.fulfilmentInventoryLocation`।  
  **কেন:** অর্ডার ডিটেইলে হাব তথ্য দেখাতে।

- **createOrder:** প্যারামে `fulfilmentInventoryLocationId?`, `orderSource?`; prisma create-তে সেট;  
  নতুন হেল্পার `getDefaultFulfilmentLocationForBranch(branchId, "SHOP"|"CLINIC")`।  
  **কেন:** POS/CLINIC অর্ডারে ডিফল্ট SHOP/CLINIC লোকেশন রেজলিউভ করতে।

**ফাইল: `backend-api/src/api/v1/modules/orders/orders.controller.ts`**

- **createOrder:**  
  বডি থেকে `orderSource`, `fulfilmentInventoryLocationId`;  
  ONLINE হলে locationId আবশ্যক ও ONLINE_HUB যাচাই;  
  POS/CLINIC হলে ডিফল্ট লোকেশন রেজলিউভ;  
  লোকেশন থাকলে ledger দিয়ে স্টক চেক ও create পর `ledgerService.saleFEFO` (SALE_ONLINE/SALE_POS/SALE_CLINIC);  
  লোকেশন না থাকলে পুরনো inventory path।  
  **কেন:** ডক অনুযায়ী ভ্যালিডেশন ও লোকেশন-ভিত্তিক স্টক ডিডাক্ট।

- **getOrders:** `req.query.fulfilmentInventoryLocationId` সার্ভিসে পাস।  
  **কেন:** Owner UI হাব ফিল্টার।

- **cancelOrder:**  
  `fulfilmentInventoryLocationId` থাকলে `ledgerService.restoreStockForOrderCancel`;  
  নাহলে পুরনো adjustStock রিস্টোর।  
  **কেন:** ক্যানসেলে স্টক সেই লোকেশনে ফেরত।

---

### D) Ledger integration

**ফাইল: `backend-api/src/api/v1/modules/inventory/ledger.service.ts`**

- **saleFEFO:** `saleType`-এ `"SALE_CLINIC"` যোগ; ডিফল্ট refType `"ORDER"`।  
  **কেন:** ক্লিনিক সেল লেজারে SALE_CLINIC ব্যবহার।

- **নতুন ফাংশন:** `restoreStockForOrderCancel(locationId, items, refId, createdByUserId)` — RETURN_IN এন্ট্রি, refType `ORDER_CANCEL`।  
  **কেন:** অর্ডার ক্যানসেলে একই লোকেশনে স্টক রিস্টোর।

**ফাইল: `backend-api/src/api/v1/modules/pos/pos.service.ts`**

- SHOP লোকেশন রেজলিউভ; createOrder-এ `orderSource: "POS"`, `fulfilmentInventoryLocationId: shopLocationId`;  
  স্টক চেক ledger দিয়ে; ডিডাক্ট `ledgerService.saleFEFO` (SALE_POS);  
  SHOP না থাকলে পুরনো inventory path।  
  **কেন:** POS অর্ডার SHOP টাইপ লোকেশন থেকে লেজার ডিডাক্ট।

---

### E) Owner hubs endpoint

**ফাইল: `backend-api/src/api/v1/modules/owner/owner.controller.ts`**

- **নতুন হ্যান্ডলার:** `exports.getHubs` — `getEffectiveBranchIdsForOwnerPanel` দিয়ে scope;  
  `InventoryLocation.findMany({ branchId: { in: branchIds }, type: 'ONLINE_HUB', isActive: true })`।  
  **কেন:** Owner প্যানেলে হাব ড্রপডাউন ও ফিল্টার।

**ফাইল: `backend-api/src/api/v1/modules/owner/owner.routes.ts`**

- **যোগ:** `router.get('/hubs', ctrl.getHubs)`।  
  **কেন:** GET /api/v1/owner/hubs এক্সপোজ করতে।

---

## PHASE 2 — FRONTEND (Owner Panel)

**ফাইল: `bpa_web/app/owner/_lib/ownerApi.ts`**

- **যোগ:** `getOwnerHubs()` — GET /api/v1/owner/hubs কল করে হাব লিস্ট রিটার্ন।  
  **কেন:** অর্ডার পেজে হাব ফিল্টার ড্রপডাউন।

**ফাইল: `bpa_web/app/owner/orders/page.tsx`**

- হাব স্টেট ও `getOwnerHubs()` দিয়ে হাব লোড;  
  ফিল্টার ড্রপডাউন "সব হাব" + হাব লিস্ট;  
  `loadOrders`-এ `fulfilmentInventoryLocationId` কোয়েরি প্যারাম;  
  টেবিলে কলাম "Fulfilment Hub" — `fulfilmentInventoryLocation.name` অথবা "পুরনো অর্ডার"।  
  **কেন:** ডক অনুযায়ী হাব দিয়ে ফিল্টার ও লিস্টে হাব দেখানো।

**ফাইল: `bpa_web/app/owner/orders/[id]/page.tsx`**

- Order টাইপে `fulfilmentInventoryLocation`, `orderSource`, `fulfilmentInventoryLocationId`;  
  সাইডবারে "Fulfilment Hub" — থাকলে নাম + ব্রাঞ্চ, না থাকলে "পুরনো অর্ডার — হাব সেট করা নেই"।  
  **কেন:** ব্যাকওয়ার্ড কম্প্যাটিবিলিটি ও ডক অনুযায়ী পুরনো অর্ডার বার্তা।

---

## Sample API requests

**1) choose-hub**  
`POST /api/v1/online-store/checkout/choose-hub`  
Body: `{ "items": [{ "variantId": 10, "quantity": 2 }] }`  
Response: `data.recommended.hubId` = InventoryLocation.id (ONLINE_HUB)।

**2) Create ONLINE order**  
`POST /api/v1/orders` (auth)  
Body: `{ "branchId": 1, "customerId": 100, "fulfilmentInventoryLocationId": 5, "orderSource": "ONLINE", "items": [{ "productId": 1, "variantId": 10, "quantity": 2, "price": 299.50 }], "paymentMethod": "ONLINE" }`  
Response: order with `fulfilmentInventoryLocationId`, `orderSource`, `fulfilmentInventoryLocation`।

**3) POS sale**  
`POST /api/v1/pos/sale` (auth)  
Body: `{ "branchId": 1, "items": [{ "productId": 1, "variantId": 10, "quantity": 1, "price": 299.50 }], "paymentMethod": "CASH" }`  
Backend স্বয়ংক্রিয়ভাবে ব্রাঞ্চের SHOP লোকেশন রেজলিউভ করে স্টক কাটে।

---

## Manual test steps

1. **Owner panel:** লগইন → Orders → হাব ড্রপডাউন থেকে একটি হাব সিলেক্ট করে অর্ডার লিস্ট চেক; টেবিলে "Fulfilment Hub" কলাম ও পুরনো অর্ডারে "পুরনো অর্ডার" দেখান।
2. **Owner order detail:** কোনো অর্ডারে ঢুকে "Fulfilment Hub" ব্লকে হাব নাম বা "পুরনো অর্ডার — হাব সেট করা নেই" দেখান।
3. **Shop POS:** শপ ইউজার দিয়ে একটি সেল সম্পন্ন করুন; অর্ডার ডিটেইলে fulfilment location = সেই ব্রাঞ্চের শপ লোকেশন।
4. **Online order:** choose-hub কল করে recommended.hubId নিয়ে POST /orders এ fulfilmentInventoryLocationId ও orderSource: "ONLINE" দিয়ে অর্ডার তৈরি; স্টক সংশ্লিষ্ট ONLINE_HUB থেকে কাটা হয়েছে কিনা লেজার/ব্যালেন্স দিয়ে যাচাই।
5. **Cancel:** একটি অর্ডার ক্যানসেল করুন; সেই অর্ডারের fulfilment location-এ স্টক রিস্টোর হয়েছে কিনা চেক করুন।
6. **Staff/Team:** স্টাফ/টিম ইউজার দিয়ে GET /api/v1/owner/hubs ও অর্ডার লিস্ট চেক — ৪০৩ না হওয়া।

---

## Backward compatibility notes

- পুরনো অর্ডারে `fulfilmentInventoryLocationId` ও `orderSource` null থাকবে; সিস্টেম ভাঙবে না।
- orderSource/fulfilmentInventoryLocationId না দিয়ে create করলে আগের মতো branch-level inventory চেক ও adjustStock ব্যবহার হয়।
- UI-তে fulfilment location null হলে "পুরনো অর্ডার" (ও ডিটেইলে "পুরনো অর্ডার — হাব সেট করা নেই") দেখানো হয়।

---

## FINAL DIFF CHECKLIST

**Backend (bpa_app_api):**
- [x] `prisma/schema.prisma` — OrderSource enum, Order এ fulfilmentInventoryLocationId, orderSource, relation, indexes; InventoryLocation.ordersFulfilled; StockLedgerType এ SALE_CLINIC
- [x] `prisma/migrations/20260210120000_add_order_fulfilment_location_and_source/migration.sql` — নতুন মাইগ্রেশন
- [x] `src/api/v1/modules/orders/orders.service.ts` — getOrders filter + include fulfilmentInventoryLocation; getOrderById include; createOrder নতুন ফিল্ড + getDefaultFulfilmentLocationForBranch
- [x] `src/api/v1/modules/orders/orders.controller.ts` — createOrder validation, location resolve, ledger deduct; getOrders query param; cancelOrder ledger restore
- [x] `src/api/v1/modules/inventory/ledger.service.ts` — saleFEFO এ SALE_CLINIC; restoreStockForOrderCancel
- [x] `src/api/v1/modules/pos/pos.service.ts` — SHOP location resolve, createOrder with orderSource POS + fulfilmentInventoryLocationId, ledger deduct (fallback old inventory)
- [x] `src/api/v1/modules/owner/owner.controller.ts` — getHubs
- [x] `src/api/v1/modules/owner/owner.routes.ts` — GET /hubs

**Frontend (web_app):**
- [x] `app/owner/_lib/ownerApi.ts` — getOwnerHubs()
- [x] `app/owner/orders/page.tsx` — হাব ফিল্টার ড্রপডাউন, Fulfilment Hub কলাম, query param
- [x] `app/owner/orders/[id]/page.tsx` — Fulfilment Hub ব্লক, পুরনো অর্ডার বার্তা

**New/Changed Endpoints:**
- [x] GET /api/v1/owner/hubs — Owner scope ONLINE_HUB locations (ফিল্টার সাপোর্ট)
- [x] POST /api/v1/orders — বডিতে fulfilmentInventoryLocationId, orderSource সাপোর্ট
- [x] GET /api/v1/orders — query-তে fulfilmentInventoryLocationId সাপোর্ট; রেসপন্সে fulfilmentInventoryLocation

**Commands to run:**
- [ ] `npx prisma migrate dev --name add_order_fulfilment_location_and_source` (অথবা `npx prisma migrate deploy` প্রডাকশনে)
- [ ] `npx prisma generate`
- [ ] Backend: `npm run dev` (বা প্রকল্পের স্টার্ট কমান্ড)
- [ ] Frontend Owner: `npm run dev:owner` বা পোর্ট 3104

**Manual verification:**
- [ ] Online order → hub সেভ হয় + স্টক ONLINE_HUB থেকে কাটে
- [ ] POS sale → স্টক SHOP লোকেশন থেকে কাটে
- [ ] Owner অর্ডার লিস্টে হাব কলাম + হাব ফিল্টার কাজ করে
- [ ] অর্ডার ক্যানসেলে স্টক একই লোকেশনে রিস্টোর হয়
- [ ] Staff/Team ইউজারে hubs/orders এ ৪০৩ না হয়
