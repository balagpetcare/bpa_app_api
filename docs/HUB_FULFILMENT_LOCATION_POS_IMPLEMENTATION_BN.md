# Hub-based Online Fulfilment + Location-based Offline POS — সম্পূর্ণ ডকুমেন্টেশন (বাংলা)

**Repo/Branch:**  
- Backend: balagpetcare/bpa_app_api @ ver/V100.0.01.03  
- Frontend: balagpetcare/web_app @ ver/V100.0.01.03  

**সংক্ষিপ্ত সারসংক্ষেপ:**  
অনলাইন অর্ডার ডেলিভারি হাব (ONLINE_HUB) থেকে fulfil হবে এবং স্টক ডিডাকশন সেই হাবের `InventoryLocation` থেকে হবে; POS/ক্লিনিক অর্ডার সংশ্লিষ্ট শপ/ক্লিনিক লোকেশন থেকে ডিডাক্ট হবে। বর্তমান কোডবেসে choose-hub আছে কিন্তু Order টেবিলে fulfilment location সংরক্ষণ হয় না।

---

## ১) Vision & Scope (কি সমস্যার সমাধান)

- **সমস্যা:** অনলাইন স্টোরে চেকআউটে হাব বাছাই (`/online-store/checkout/choose-hub`) করা যায়, কিন্তু অর্ডার তৈরির সময় সেই হাব ডাটাবেইজে লিংক হয় না। ফলে (ক) কোন হাব থেকে fulfil হবে তা ট্র্যাক করা যায় না, (খ) স্টক ডিডাক্ট বর্তমানে পুরনো `Inventory` (branch-level) দিয়ে হয়, location-wise ledger (StockBalance/StockLedger) দিয়ে নয়। POS সেলও branch-level inventory ব্যবহার করে; কোন শপ/ক্লিনিক লোকেশন থেকে ডিডাক্ট হয়েছে তা অডিট করা যায় না।
- **ভিশন:**  
  - **অনলাইন:** অর্ডার সর্বদা একটি নির্বাচিত **Delivery Hub** (type = ONLINE_HUB) থেকে fulfil হবে; স্টক ডিডাক্ট ও লেজার এন্ট্রি সেই `fulfilmentInventoryLocationId` দিয়ে হবে।  
  - **অফলাইন (POS/ক্লিনিক):** শপ অর্ডার সংশ্লিষ্ট ব্রাঞ্চের **SHOP** টাইপ লোকেশন থেকে; ক্লিনিক মেডিসিন সেল (কনফিগারেবল) **CLINIC** টাইপ লোকেশন থেকে ডিডাক্ট হবে।
- **স্কোপ ইন:** Order মডেলে fulfilment location ও order source; Order create/confirm ফ্লোতে location-based ledger ডিডাক্ট; choose-hub রিটার্নে হাব আইডি; অডমিন/ওনার/শপ অর্ডার লিস্ট ও ডিটেইলে নতুন ফিল্ড; ব্যাবসায়িক নিয়ম (হাব সিলেকশন, আউট-অফ-স্টক, ক্যানসেলে স্টক রিস্টোর)।  
- **স্কোপ আউট:** মাল্টি-সোর্স ফুলফিলমেন্ট (এক অর্ডার একাধিক লোকেশন থেকে), প্রেসক্রিপশন/মেডিসিন শিডিউল, পার্টনার এমবেড ফিড।

---

## ২) Definitions (সংজ্ঞা)

| টার্ম | সংজ্ঞা |
|-------|--------|
| **Organization** | মালিকানাধীন ব্যবসায়িক ইউনিট; এক বা একাধিক Branch থাকতে পারে। স্টোর: `backend-api/prisma/schema.prisma` — model `Organization` (লাইন ~২৪৪৭)। |
| **Branch** | একটি ভৌগোলিক/লজিক্যাল লোকেশন (দোকান, ক্লিনিক, ডেলিভারি হাব ইত্যাদি)। `schema.prisma` — model `Branch` (লাইন ~২৫১৮); `orders` ও `inventoryLocations` রিলেশন আছে। |
| **InventoryLocation** | একটি ব্রাঞ্চের অধীনে স্টক রাখার লোকেশন; টাইপ: SHOP, CLINIC, ONLINE_HUB। `schema.prisma` — model `InventoryLocation` (লাইন ~৩৮৮৯), enum `InventoryLocationType` (লাইন ~২৮১৪)। |
| **ONLINE_HUB** | `InventoryLocationType` এর মান; ডেলিভারি/অনলাইন ফুলফিলমেন্টের জন্য হাব। এই টাইপের লোকেশন থেকেই অনলাইন অর্ডারের স্টক কাটা হবে। |
| **OrderSource** | অর্ডার কোথা থেকে এসেছে — ONLINE (ওয়েব/অ্যাপ চেকআউট), POS (শপ কাউন্টার), CLINIC (ক্লিনিক মেডিসিন সেল) ইত্যাদি। বর্তমান স্কিমায় **নেই**; ডকুমেন্টে প্রস্তাবিত enum/ফিল্ড। |
| **FulfilmentLocation** | যে `InventoryLocation` থেকে অর্ডার fulfil হবে (স্টক ডিডাক্ট সেই লোকেশন থেকে)। অনলাইন = chosen hub (ONLINE_HUB); POS = সেই শপের SHOP লোকেশন; ক্লিনিক = সেই ক্লিনিকের CLINIC লোকেশন। |

---

## ৩) Data Model Changes (Prisma schema পরিবর্তন)

### ৩.১ নতুন ফিল্ড (সঠিক নাম ও টাইপ)

**ফাইল:** `backend-api/prisma/schema.prisma`  
- Order মডেল: লাইন ৩৩০৫–৩৩২৯।  
- InventoryLocation মডেল: লাইন ৩৮৮৯–৩৯১৪।

- **Order মডেলে যোগ করতে হবে (লাইন ৩৩১৫ এর পরে, items রিলেশনের আগে):**
  - `fulfilmentInventoryLocationId Int?` — যে InventoryLocation থেকে স্টক কাটা হবে/হয়েছে; অনলাইন অর্ডারে choose-hub থেকে আসা hubId; POS/ক্লিনিকে শপ/ক্লিনিক লোকেশন।
  - `orderSource String?` অথবা enum ব্যবহার করলে `orderSource OrderSource?` — মান: `ONLINE` | `POS` | `CLINIC` | `OTHER` (অপশনাল; ফিল্টার ও রিপোর্টিংয়ের জন্য)।

**প্রস্তাবিত Prisma স্নিপেট:**

```prisma
// Enum (schema-তে যেখানে অন্যান্য enum আছে, e.g. OrderStatus এর কাছাকাছি)
enum OrderSource {
  ONLINE
  POS
  CLINIC
  OTHER
}

model Order {
  // ... existing fields ...
  fulfilmentInventoryLocationId Int?
  orderSource                    OrderSource?

  // ... existing relations ...
  fulfilmentInventoryLocation InventoryLocation? @relation("OrderFulfilmentLocation", fields: [fulfilmentInventoryLocationId], references: [id], onDelete: SetNull)

  @@index([fulfilmentInventoryLocationId])
  @@index([orderSource])
}
```

**InventoryLocation মডেলে বিপরীত রিলেশন (লাইন ~৩৯০৮ এর পরে):**

```prisma
model InventoryLocation {
  // ... existing fields and relations ...
  ordersFulfilled Order[] @relation("OrderFulfilmentLocation")
}
```

### ৩.২ রিলেশন ও ইন্ডেক্স

- `Order.fulfilmentInventoryLocationId` → `InventoryLocation.id` (optional, onDelete: SetNull).
- ইন্ডেক্স: `Order(fulfilmentInventoryLocationId)`, `Order(orderSource)` — লিস্ট/ফিল্টার ও জয়িনের জন্য।

### ৩.৩ মাইগ্রেশন কৌশল

- নতুন কলাম দুটো **nullable** রাখা; কোনো existing row আপডেট বাধ্যতামূলক নয়।
- মাইগ্রেশন: `npx prisma migrate dev --name add_order_fulfilment_location_and_source`
- পুরনো অর্ডার: `fulfilmentInventoryLocationId` ও `orderSource` null থাকবে; ব্যাকওয়ার্ড কম্প্যাটিবিলিটি রাখা।
- পরবর্তীতে রিপোর্ট/অডিটের জন্য optional ব্যাকফিল স্ক্রিপ্ট চালানো যেতে পারে (যে অর্ডারগুলো branchId দিয়ে শনাক্ত করা যায় সেগুলোতে orderSource অনুমান করে সেট করা)।

---

## ৪) API Contract

### ৪.১ Online-store: choose-hub — যা রিটার্ন করে

**এন্ডপয়েন্ট:** `POST /api/v1/online-store/checkout/choose-hub`  
**ফাইল:**  
- রাউট: `backend-api/src/api/v1/modules/online-store/online-store.routes.ts` (লাইন ১৩–১৪)  
- কন্ট্রোলার: `backend-api/src/api/v1/modules/online-store/online-store.controller.ts` (লাইন ৫৯–৯৪)  
- সার্ভিস: `backend-api/src/api/v1/modules/online-store/online-store.service.ts` — `chooseHubForCheckout` (লাইন ২২৯–২৯৮)

**বর্তমান রেসপন্স:**  
`{ success, data: { hubs: [{ hubId, hubName, branchName, canFulfill, items: [{ variantId, available, required }] }], recommended: {...} | null } }`

**কন্ট্রাক্ট (পরিবর্তন পরবর্তী):**  
- `data.recommended` এবং `data.hubs[].hubId` — এই `hubId` হল `InventoryLocation.id` (ONLINE_HUB)। অর্ডার ক্রিয়েশনের সময় এই `hubId` পাঠাতে হবে `fulfilmentInventoryLocationId` হিসেবে।
- ভবিষ্যতে প্রয়োজনে `data.recommended.locationId` বা `data.recommended.inventoryLocationId` নামে এক্সপ্লিসিট ফিল্ড যোগ করা যেতে পারে (এখনই লজিক একই: hubId = location id)।

### ৪.২ Orders: create — প্রয়োজনীয় পেলোড পরিবর্তন

**এন্ডপয়েন্ট:** `POST /api/v1/orders`  
**ফাইল:**  
- রাউট: `backend-api/src/api/v1/modules/orders/orders.routes.ts`  
- কন্ট্রোলার: `backend-api/src/api/v1/modules/orders/orders.controller.ts` — `createOrder` (লাইন ৮৯–১৯৫)  
- সার্ভিস: `backend-api/src/api/v1/modules/orders/orders.service.ts` — `createOrder` (লাইন ১৫১–২০১)

**বর্তমান বডি:**  
`{ branchId, customerId?, items: [{ productId, variantId?, quantity, price }], paymentMethod?, notes? }`

**পরিবর্তন:**  
- **অপশনাল:** `fulfilmentInventoryLocationId` (number) — দেওয়া থাকলে অর্ডার এই লোকেশন দিয়ে fulfil হবে; স্টক চেক ও ডিডাক্ট এই locationId দিয়ে (ledger); না দিলে ব্যাকওয়ার্ডভাবে branch-based লজিক (অথবা শপের ডিফল্ট SHOP লোকেশন রেজলিউশন)।  
- **অপশনাল:** `orderSource` (string/enum: ONLINE | POS | CLINIC | OTHER) — অর্ডার সোর্স; ফিল্টার ও অডিটের জন্য।

**নিয়ম:**  
- যদি `orderSource === "ONLINE"` বা অনলাইন চেকআউট থেকে ক্রিয়েট করা হয়, তাহলে `fulfilmentInventoryLocationId` **আবশ্যক** এবং তা অবশ্যই type ONLINE_HUB এমন একটি `InventoryLocation.id` হতে হবে।  
- POS ফ্লোতে `fulfilmentInventoryLocationId` পাঠানো না থাকলে সেই ব্রাঞ্চের SHOP টাইপ লোকেশন (অথবা কনফিগ) থেকে রেজলিউভ করা।

### ৪.৩ Orders: admin/owner/shop list ও detail — রেসপন্সে নতুন ফিল্ড

**এন্ডপয়েন্ট:**  
- `GET /api/v1/orders` — লিস্ট  
- `GET /api/v1/orders/:id` — ডিটেইল  

**ফাইল:**  
- সার্ভিস: `backend-api/src/api/v1/modules/orders/orders.service.ts` — `getOrders` (লাইন ১৬–১০৪), `getOrderById` (লাইন ১০৯–১৪৬)

**রেসপন্সে যোগ করতে হবে:**  
- প্রতিটি অর্ডার অবজেক্টে: `fulfilmentInventoryLocationId`, `orderSource`  
- ডিটেইলে (এবং লিস্টে প্রয়োজনে): `fulfilmentInventoryLocation` — include করে `{ id, name, code, type, branch: { id, name } }` যাতে UI-তে “ফুলফিলমেন্ট লোকেশন” দেখানো যায়।

### ৪.৪ Inventory deduction rules (ledger references)

- **অনলাইন অর্ডার:** স্টক ডিডাক্ট `fulfilmentInventoryLocationId` (হাব) দিয়ে; `StockLedger`: `refType = "ORDER"`, `refId = order.id` বা `order.orderNumber`; টাইপ `SALE_ONLINE`।  
- **POS অর্ডার:** স্টক ডিডাক্ট শপের `InventoryLocation` (type SHOP) দিয়ে; `refType = "ORDER"`, `refId = order.id`/orderNumber; টাইপ `SALE_POS`।  
- **ক্লিনিক মেডিসিন:** কনফিগারেবল CLINIC লোকেশন দিয়ে; একইভাবে refType/refId দিয়ে অর্ডার লিংক।  
- লেজার সার্ভিস: `backend-api/src/api/v1/modules/inventory/ledger.service.ts` — `recordLedgerEntryInTx`, `saleFEFO` ইত্যাদি; `refType`/`refId` ইতিমধ্যে সাপোর্ট করে। অর্ডার ক্রিয়েট/কনফার্ম ফ্লোতে এই সার্ভিস ব্যবহার করে location-based ডিডাক্ট করতে হবে।

---

## ৫) Business Rules (বুলেট লিস্ট)

- অনলাইন অর্ডারের স্টক **সর্বদা** `fulfilmentInventoryLocationId` (ONLINE_HUB) থেকে ডিডাক্ট হবে; choose-hub থেকে নির্বাচিত হাবই এই লোকেশন।
- POS অর্ডারের স্টক সংশ্লিষ্ট শপের **SHOP** টাইপ `InventoryLocation` থেকে ডিডাক্ট হবে (যে ব্রাঞ্চ থেকে অর্ডার তৈরি সেই ব্রাঞ্চের শপ লোকেশন; একাধিক থাকলে কনফিগ/ডিফল্ট নিয়ম)।
- ক্লিনিক মেডিসিন সেল সংশ্লিষ্ট ক্লিনিকের **CLINIC** টাইপ `InventoryLocation` থেকে ডিডাক্ট হবে (কনফিগারেবল: ব্রাঞ্চ/ক্লিনিক সেটিং বা ডিফল্ট)।
- হাব সিলেকশন পলিসি: choose-hub যে হাবগুলো সব আইটেম fulfil করতে পারে সেগুলো রিটার্ন করে; রিকমেন্ডেড = প্রথম উপলব্ধ হাব; ভবিষ্যতে দূরত্ব (lat/lng) বা প্রায়োরিটি যোগ করা যাবে।
- আংশিক স্টক / আউট-অফ-স্টক: choose-hub শুধু সেই হাবগুলো রিটার্ন করে যেগুলো **সব** আইটেম fulfil করতে পারে (`canFulfill: true`); কোনো হাব না থাকলে অর্ডার প্লেস করা যাবে না অথবা UI-তে আংশিক/ব্যাকঅর্ডার ফ্লো আলাদা পলিসি অনুযায়ী।
- অর্ডার ক্যানসেল হলে যে লোকেশন থেকে ডিডাক্ট হয়েছিল সেই লোকেশনে স্টক রিস্টোর করতে হবে; refType/refId দিয়ে লেজার ট্রেস করা যাবে।

---

## ৬) Step-by-step Implementation Plan (১০–১৪ ধাপ)

| ধাপ | Goal | Files to change (exact paths) | What to add/remove (short) | Risk/edge cases |
|-----|-----|--------------------------------|----------------------------|------------------|
| 1 | Order মডেলে fulfilment + orderSource ফিল্ড ও রিলেশন যোগ | `backend-api/prisma/schema.prisma` | Order-এ `fulfilmentInventoryLocationId Int?`, `orderSource OrderSource?`, relation to InventoryLocation; InventoryLocation-এ `ordersFulfilled`; enum OrderSource; @@index | বিদ্যমান অর্ডার null; মাইগ্রেশন নাম ইউনিক |
| 2 | মাইগ্রেশন তৈরি ও চালানো | `backend-api/prisma/migrations/` | `npx prisma migrate dev --name add_order_fulfilment_location_and_source` | ডিভ ডাটাবেইজ ব্যাকআপ নেওয়া |
| 3 | orders.service createOrder এ নতুন ফিল্ড সাপোর্ট | `backend-api/src/api/v1/modules/orders/orders.service.ts` | createOrder data-তে `fulfilmentInventoryLocationId?`, `orderSource?` নেওয়া ও prisma.order.create-তে সেট করা | null হ্যান্ডলিং |
| 4 | orders.controller createOrder: বডি থেকে ফিল্ড পাঠানো + ভ্যালিডেশন | `backend-api/src/api/v1/modules/orders/orders.controller.ts` | req.body থেকে fulfilmentInventoryLocationId, orderSource; ONLINE হলে locationId যাচাই (ONLINE_HUB); service-এ পাস | অননুমোদিত locationId; ভুল টাইপ |
| 5 | অর্ডার ক্রিয়েশনে location-based স্টক চেক ও ডিডাক্ট (ledger) | `backend-api/src/api/v1/modules/orders/orders.controller.ts` (এবং/অথবা orders.service বা আলাদা orderFulfilment.service) | fulfilmentInventoryLocationId থাকলে ledgerService.getStockBalance(locationId, variantId) দিয়ে চেক; create পর ledgerService.saleFEFO(..., refType: "ORDER", refId: order.id) | পুরনো Inventory path থেকে সরে এসে শুধু ledger path ব্যবহার করলে POS/অনলাইন দুটোতেই location রেজলিউশন দরকার |
| 6 | POS ফ্লো: শপ লোকেশন রেজলিউশন + ledger ডিডাক্ট | `backend-api/src/api/v1/modules/pos/pos.service.ts` | createSale-এ ব্রাঞ্চের SHOP টাইপ InventoryLocation বের করে fulfilmentInventoryLocationId সেট; order create-এ পাস; স্টক ডিডাক্ট ledger দিয়ে (locationId দিয়ে) | এক ব্রাঞ্চে একাধিক SHOP থাকলে ডিফল্ট নিয়ম |
| 7 | getOrders/getOrderById তে fulfilment location include ও রিটার্ন | `backend-api/src/api/v1/modules/orders/orders.service.ts` | findMany/findFirst-এ include: { fulfilmentInventoryLocation: { select: { id, name, code, type, branch: { id, name } } } }; রেসপন্সে ফিল্ড থাকবে | নেই |
| 8 | choose-hub রেসপন্সে locationId স্পষ্ট (প্রয়োজনে) | `backend-api/src/api/v1/modules/online-store/online-store.service.ts` | recommended ও hubs-এ `inventoryLocationId` বা সমতুল্য ফিল্ড যোগ (hubId ই এখন location id) | ক্লায়েন্ট যেন order create-এ এই id পাঠায় |
| 9 | অর্ডার ক্যানসেল: স্টক রিস্টোর একই fulfilment location এ | `backend-api/src/api/v1/modules/orders/orders.controller.ts` (cancelOrder) | ক্যানসেলের পর order.fulfilmentInventoryLocationId ও items ব্যবহার করে ledger-এ IN/রিস্টোর এন্ট্রি (refType ORDER_CANCEL বা RETURN_IN + refId) | শুধু CONFIRMED/PROCESSING ইত্যাদি স্ট্যাটাসে রিস্টোর |
| 10 | Owner প্যানেল অর্ডার লিস্ট/ডিটেইলে fulfilment location দেখানো | `bpa_web/app/owner/orders/page.tsx`, `bpa_web/app/owner/orders/[id]/page.tsx` | API থেকে data.fulfilmentInventoryLocation; টেবিল/ডিটেইলে “ফুলফিলমেন্ট লোকেশন” বা হাব নাম দেখানো | API কন্ট্রাক্ট অনুযায়ী ফিল্ড নাম |
| 11 | Shop প্যানেল অর্ডার ডিটেইলে (প্রয়োজনে) | `bpa_web/app/shop/orders/[id]/page.tsx` | একইভাবে fulfilment location দেখানো | যেমন ধাপ ১০ |
| 12 | অনলাইন চেকআউট ফ্লো (মাদার/পার্টনার): choose-hub কল 후 order create-এ fulfilmentInventoryLocationId পাঠানো | **MISSING** — ফ্রন্টএন্ডে পাবলিক চেকআউট পেজ নেই; থাকলে সেই পেজ/API কল | choose-hub এর recommended.hubId (বা inventoryLocationId) সেভ করে POST /orders এ fulfilmentInventoryLocationId ও orderSource: "ONLINE" পাঠানো | চেকআউট পেজ না থাকলে পরবর্তী ফেজে যোগ করতে হবে |
| 13 | ইউনিট টেস্ট: order create with fulfilment location, stock deduct by location | `backend-api/src/api/v1/modules/orders/` বা __tests__ | createOrder with fulfilmentInventoryLocationId; ledger এন্ট্রি ও ব্যালেন্স চেক | — |
| 14 | ডকুমেন্টেশন ও চেকলিস্ট আপডেট | `backend-api/docs/` | এই ডক ও CURRENT_IMPLEMENTATION_AUDIT_GAP_ANALYSIS_BN.md আপডেট; মার্জ আগে চেকলিস্ট | — |

---

## ৭) Testing Plan

### ৭.১ ইউনিট টেস্ট (সার্ভিস)

- **orders.service.createOrder:** fulfilmentInventoryLocationId ও orderSource দিয়ে অর্ডার তৈরি; DB-তে ফিল্ড মান চেক।
- **ledger.service:** একটি location + variant এ স্টক থাকা অবস্থায় saleFEFO (SALE_ONLINE) কল; StockBalance ও StockLedger এন্ট্রি এবং refType/refId চেক।
- **online-store.service.chooseHubForCheckout:** কয়েকটি variant ও হাব দিয়ে কল; recommended ও hubs-এ canFulfill ও hubId সঠিক কিনা।

**ফাইল (প্রস্তাবিত):**  
- `backend-api/src/api/v1/modules/orders/__tests__/orders.service.test.ts` (MISSING — তৈরি করতে হবে)  
- `backend-api/src/api/v1/modules/inventory/__tests__/ledger.service.test.ts` (আগে থেকে থাকলে সেখানে নতুন কেস)

### ৭.২ API টেস্ট (পোস্টম্যান-স্টাইল)

1. **choose-hub:** `POST /api/v1/online-store/checkout/choose-hub` — body: `{ "items": [{ "variantId": 1, "quantity": 2 }] }` — রেসপন্সে hubs ও recommended; recommended.hubId নোট করা।
2. **Order create (অনলাইন):** `POST /api/v1/orders` (auth হেডার সহ) — body-তে branchId, items, `fulfilmentInventoryLocationId: <recommended.hubId>`, `orderSource: "ONLINE"` — ২০১; রেসপন্সে fulfilmentInventoryLocationId ও orderSource থাকা।
3. **Order list/detail:** `GET /api/v1/orders`, `GET /api/v1/orders/:id` — রেসপন্সে fulfilmentInventoryLocation অবজেক্ট।
4. **POS:** শপ ইউজার দিয়ে POS সেল — অর্ডারে fulfilmentInventoryLocationId = সেই ব্রাঞ্চের SHOP লোকেশন।
5. **স্টক যাচাই:** সংশ্লিষ্ট InventoryLocation + variant এর জন্য GET ledger বা balance — ORDER refType/refId দিয়ে এন্ট্রি।

### ৭.৩ ম্যানুয়াল UI টেস্ট

- **Owner প্যানেল:** অর্ডার লিস্ট ও ডিটেইলে “ফুলফিলমেন্ট লোকেশন”/হাব নাম দেখানো; ফিল্টার orderSource (যদি UI যোগ করা হয়)।
- **Shop POS:** একটি সেল সম্পন্ন করে অর্ডার ডিটেইলে শপ লোকেশন দেখানো; স্টক সেই শপ লোকেশন থেকে কমেছে কিনা ইনভেন্টরি/লেজার পেজ থেকে চেক।

---

## ৮) Rollout Plan

- **ব্যাকওয়ার্ড কম্প্যাটিবিলিটি:** নতুন ফিল্ড nullable; পুরনো ক্লায়েন্ট order create without fulfilmentInventoryLocationId চালিয়ে যেতে পারবে; সেক্ষেত্রে (ক) শপ ফ্লোতে ব্রাঞ্চের ডিফল্ট SHOP লোকেশন রেজলিউভ করা, অথবা (খ) আগের মতো branch-level inventory লজিক রাখা (deprecated) — পলিসি নির্ভর।
- **ডাটা মাইগ্রেশন:** existing অর্ডারগুলোতে fulfilmentInventoryLocationId ও orderSource null; প্রয়োজন হলে আলাদা ব্যাকফিল স্ক্রিপ্ট (নন-ডিস্ট্রাকটিভ)।
- **ফিচার ফ্ল্যাগ (প্রয়োজনে):** উদাহরণ: `USE_ORDER_FULFILMENT_LOCATION=true` — true হলে createOrder fulfilmentInventoryLocationId/orderSource ও location-based ledger বাধ্যতামূলক; false হলে পুরনো আচরণ। এনভ বা কনফিগ থেকে পড়া।

---

## ৯) Appendix

### ৯.১ Example request/response JSON

**POST /api/v1/online-store/checkout/choose-hub (response):**

```json
{
  "success": true,
  "data": {
    "hubs": [
      {
        "hubId": 5,
        "hubName": "Dhaka North Hub",
        "branchName": "Dhaka North",
        "canFulfill": true,
        "items": [
          { "variantId": 10, "available": 20, "required": 2 }
        ]
      }
    ],
    "recommended": {
      "hubId": 5,
      "hubName": "Dhaka North Hub",
      "branchName": "Dhaka North",
      "canFulfill": true,
      "items": [...]
    }
  }
}
```

**POST /api/v1/orders (request — অনলাইন):**

```json
{
  "branchId": 1,
  "customerId": 100,
  "fulfilmentInventoryLocationId": 5,
  "orderSource": "ONLINE",
  "items": [
    { "productId": 1, "variantId": 10, "quantity": 2, "price": 299.50 }
  ],
  "paymentMethod": "ONLINE",
  "notes": "Delivery to address"
}
```

**GET /api/v1/orders/:id (response — নতুন ফিল্ড সহ):**

```json
{
  "success": true,
  "data": {
    "id": 42,
    "orderNumber": "BPA-ABC123-XY",
    "branchId": 1,
    "fulfilmentInventoryLocationId": 5,
    "orderSource": "ONLINE",
    "status": "CONFIRMED",
    "totalAmount": "599.00",
    "fulfilmentInventoryLocation": {
      "id": 5,
      "name": "Dhaka North Hub",
      "code": "HUB-DN",
      "type": "ONLINE_HUB",
      "branch": { "id": 2, "name": "Dhaka North" }
    },
    "items": [...],
    "branch": {...},
    "customer": {...}
  }
}
```

### ৯.২ Example DB records (Order + InventoryLocation)

**InventoryLocation (হাব):**

| id | branchId | type       | name             | code    | isActive |
|----|----------|------------|------------------|--------|----------|
| 5  | 2        | ONLINE_HUB | Dhaka North Hub  | HUB-DN | true     |

**Order:**

| id | orderNumber     | branchId | fulfilmentInventoryLocationId | orderSource | status   |
|----|-----------------|----------|--------------------------------|-------------|----------|
| 42 | BPA-ABC123-XY   | 1        | 5                               | ONLINE      | CONFIRMED|

**StockLedger (অর্ডার ডিডাক্টের পর):**

| id | locationId | variantId | type        | quantityDelta | refType | refId |
|----|------------|-----------|-------------|---------------|---------|-------|
| 99 | 5          | 10        | SALE_ONLINE | -2            | ORDER   | 42    |

### ৯.৩ Checklist before merge

- [ ] Prisma schema-তে Order এ fulfilmentInventoryLocationId, orderSource ও InventoryLocation রিলেশন যোগ হয়েছে।
- [ ] মাইগ্রেশন চালানো ও ডিভ ডাটাবেইজে পরীক্ষা হয়েছে।
- [ ] Order create API-তে নতুন ফিল্ড নেওয়া ও ভ্যালিডেশন (ONLINE হলে locationId আবশ্যক)।
- [ ] অর্ডার ক্রিয়েট/কনফার্মে location-based ledger ডিডাক্ট (refType ORDER, refId order.id)।
- [ ] POS ফ্লোতে শপ লোকেশন রেজলিউশন ও অর্ডারে সেট।
- [ ] Order list/detail API-তে fulfilmentInventoryLocation include ও রেসপন্সে ফিল্ড।
- [ ] ক্যানসেলে স্টক রিস্টোর একই fulfilment location এ।
- [ ] Owner/Shop অর্ডার UI-তে fulfilment location দেখানো।
- [ ] API টেস্ট ও ম্যানুয়াল চেক সম্পন্ন।
- [ ] ডকুমেন্টেশন (এই ফাইল ও গ্যাপ অডিট) আপডেট।

---

*এই ডকুমেন্টটি কপি করে ChatGPT বা অন্য টুলে পেস্ট করে বিশ্লেষণ বা পরবর্তী ইমপ্লিমেন্টেশন প্ল্যান করতে পারবেন।*
