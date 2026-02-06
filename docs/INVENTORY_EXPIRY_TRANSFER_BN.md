## এক্সপায়ারি-ভিত্তিক ব্রাঞ্চ স্টক ট্রান্সফার ডিজাইন (ব্যাকএন্ড)

### ১. লক্ষ্য

- **ব্যবসায়িক উদ্দেশ্য**: একাধিক ব্রাঞ্চ থাকা একই অর্গানাইজেশনে পুরনো (এক্সপায়ারি কাছাকাছি) স্টক যেন অপচয় না হয়ে সেইসব ব্রাঞ্চে পাঠানো যায় যেখানে ওই প্রোডাক্ট বেশি বিক্রি হয়।
- **টেকনিক্যাল লক্ষ্য**:
  - বিদ্যমান ইনভেন্টরি ও ট্রান্সফার সিস্টেমের উপর বসে একটি **expiry-aware suggestion layer** বানানো।
  - Owner / Branch Manager যেন **এক-ক্লিকে draft Stock Transfer** তৈরি করতে পারে (semi-auto ফ্লো)।

---

### ২. বিদ্যমান ব্যাকএন্ড টাচ-পয়েন্ট (inventory + transfers)

- `prisma.inventory` + `prisma.product_variants`:
  - `inventory.service.ts` থেকে:
    - `getInventory(...)`
    - `getExpiringItems(branchId?, daysAhead?)`
    - `adjustStock(...)`
    - `transferStock(...)` (simple, একক আইটেম ভিত্তিক)
- `StockTransfer` + `StockTransferItem` (Prisma `stock_transfers` এবং `stock_transfer_items`):
  - মডেল: `StockTransfer`, `StockTransferItem` (schema শেষে)
  - সার্ভিস: `src/api/v1/modules/transfers/transfers.service.ts`
    - `createTransfer(...)` – draft transfer (multiple items)
    - `sendTransfer(...)` – TRANSFER_OUT ledger entries
    - `receiveTransfer(...)` – TRANSFER_IN, DAMAGE, EXPIRED ledger entries
    - `getTransfers(...)`, `getTransferById(...)`
- ইনভেন্টরি লোকেশন / লেজার:
  - `InventoryLocation`, `StockBalance`, `StockLedger` ইত্যাদির ওপর `ledger.service` দিয়ে স্টক মুভমেন্ট সিস্টেম আছে।

**সিদ্ধান্ত**:  
নতুন এক্সপায়ারি-ভিত্তিক সাজেশন সিস্টেমটি **বিদ্যমান `StockTransfer` ও ledger flow-এর ওপরই** বসবে। অর্থাৎ:

- নতুন মডেল/টেবিল কেবল **পছন্দ (preference)/রুল কনফিগারেশনের** জন্য লাগতে পারে।
- স্টক মুভমেন্ট, লেজার, audit trail – সব **আগের পথেই** চলবে।

---

### ৩. কনফিগারেশন: Branch Product Preference (কনসেপ্ট)

> নোট: এটা ডিজাইন লেভেল কনসেপ্ট; আলাদা Prisma মডেল/মাইগ্রেশন ভবিষ্যৎ ধাপে করা হবে।

#### ৩.১ উদ্দেশ্য

- কোন ব্রাঞ্চকে **source** আর কোন ব্রাঞ্চকে **preferred target** ধরা হবে, সেটি configurable করতে হবে।
- প্রোডাক্ট বা ক্যাটাগরি লেভেলে “এই source ব্রাঞ্চ থেকে পুরনো স্টক গেলে সাধারণত কোন কোন ব্রাঞ্চে পাঠানো উচিত” – এমন রুল সংরক্ষণ।

#### ৩.২ কনসেপ্টুয়াল মডেল

```text
BranchProductPreference (concept)
---------------------------------
id                    Int
orgId                 Int
sourceBranchId        Int        // যে ব্রাঞ্চ থেকে পুরনো স্টক বের হবে
preferredTargetIds    Int[]      // ordered list of branchIds
productId?            Int        // নির্দিষ্ট প্রোডাক্টের জন্য
categoryId?           Int        // অথবা ক্যাটাগরি-লেভেল
priorityOrder         Int        // একাধিক কনফিগ থাকলে অর্ডার
isActive              Boolean
createdByUserId       Int
createdAt             DateTime
updatedAt             DateTime
```

**ম্যাপিং ধারণা (Prisma-এর সাথে):**

- ভবিষ্যতে `BranchProductPreference` নামের একটি Prisma মডেল করা যেতে পারে যার মধ্যে:
  - `orgId` → `Organization`
  - `sourceBranchId` → `Branch`
  - `preferredTargetIds` → JSON / আলাদা join টেবিল (normalized design)।
- প্রথম ধাপে ব্যবসা দৃষ্টিকোণ থেকে ডকুমেন্টেড কনফিগারেশন কনসেপ্ট – পরের ধাপে আলাদা MIGRATION ফাইলে রূপান্তর করা হবে।

---

### ৪. Expiry Transfer Suggestion সার্ভিস (TransferRuleEngine ধারণা)

#### ৪.১ ইনপুট ডাটা সোর্স

- `inventory` / `StockBalance`:
  - প্রতিটি `branch + variant` কম্বোর জন্য:
    - `onHandQty` / `quantity` (বর্তমান স্টক)
    - `minStock` (low-stock থ্রেশহোল্ড)
    - `expiryDate` (যদি batch-level field থাকে; বর্তমানে `inventory.expiryDate` আছে)
- `getExpiringItems(branchId?, daysAhead?)` (`inventory.service.ts`):
  - নির্দিষ্ট ব্রাঞ্চ বা সব ব্রাঞ্চের জন্য **আগামী N দিনের মধ্যে expire হতে যাওয়া আইটেম** বের করতে পারি।
- ভবিষ্যৎ এক্সটেনশন:
  - `sales_velocity`: নির্দিষ্ট সময়ের সেল ট্রেন্ড (বর্তমানে আলাদা ফাংশন নেই; পরের ধাপে যোগ করা যাবে)।

#### ৪.২ কনফিগ ভ্যালু

- `expiry_alert_days_for_transfer` (org-level বা system-level):
  - উদাহরণ: ৩০ / ৪৫ / ৬০ দিন
  - এই সময়সীমার মধ্যে পড়ে এমন প্রোডাক্টকে “expiring soon” ধরা হবে।

---

### ৫. TransferRuleEngine – হাই-লেভেল Pseudo-code

#### ৫.১ ফাংশন সিগনেচার (ধারণা)

```ts
type ExpiryTransferSuggestion = {
  sourceBranchId: number;
  targetBranchId: number;
  variantId: number;
  productId: number;
  daysToExpiry: number;
  availableQty: number;
  suggestedQty: number;
};

async function generateExpiryTransferSuggestions(
  orgId: number,
  options?: { daysAhead?: number }
): Promise<ExpiryTransferSuggestion[]> {
  // ...
}
```

#### ৫.২ ধাপভিত্তিক লজিক

১) **Expiring items লোড করা**

- `getExpiringItems(undefined, daysAhead)` দিয়ে সব ব্রাঞ্চের expiring inventory বের করা  
  (অথবা branch-wise লুপ করে aggregate)।

২) **প্রতিটি আইটেমের জন্য branch preference দেখা**

- প্রতিটি `item` এর জন্য (যেখানে `item.branchId = sourceBranchId`):
  - `BranchProductPreference` (concept) থেকে:
    - `preferredTargetIds` লিস্ট বের করা (orgId, sourceBranchId, productId/categoryId match করে)।
  - যদি কোন কনফিগ না থাকে → ওই আইটেমের জন্য সাজেশন স্কিপ।

৩) **Target branch ফিল্টার করা**

- প্রতিটি `targetBranchId` এর জন্য:
  - ঐ ব্রাঞ্চে একই `variantId`-এর বর্তমান স্টক (inventory/stockBalance) চেক করা।
  - যদি target ব্রাঞ্চ ইতিমধ্যেই over-stock / expiring risk-এ থাকে:
    - সেই ব্রাঞ্চ স্কিপ করে পরের preferred branch নেওয়া।

৪) **Suggested quantity নির্ধারণ**

সিম্পল ফার্স্ট ভার্সন রুল:

- `availableQty = item.quantity`
- `suggestedQty`:
  - যদি business চায় পুরো ব্যাচ পাঠাতে → `suggestedQty = availableQty`
  - নাহলে:
    - `suggestedQty = min(availableQty, safeTargetCapacity)`  
    (future enhancement: sales velocity + remaining days হিসাব করে safe capacity গণনা)

৫) **Suggestion অবজেক্ট তৈরি করা**

- প্রতি valid `sourceBranchId + targetBranchId + variantId` এর জন্য:

```ts
suggestions.push({
  sourceBranchId: item.branchId,
  targetBranchId,
  variantId: item.variantId,
  productId: item.productId,
  daysToExpiry,
  availableQty,
  suggestedQty,
});
```

৬) **Sorting / Prioritization**

- `daysToExpiry` ascending (কম দিন বাকি এমন ব্যাচ আগে)
- প্রয়োজন হলে প্রতি source branch / প্রতি product limit রাখা যেতে পারে।

---

### ৬. Suggestion → Draft StockTransfer mapping (semi-auto ফ্লো)

#### ৬.১ Owner/Manager UI থেকে প্রত্যাশিত কল

- ফ্রন্টএন্ড (Owner/Branch Manager) থেকে:
  - `GET /api/v1/transfers/expiry-suggestions?orgId=...&daysAhead=45`
    - রেসপন্স: `ExpiryTransferSuggestion[]`
  - ইউজার টেবিল থেকে কিছু লাইন সিলেক্ট করে:
  - `POST /api/v1/transfers/from-suggestions`
    - ইনপুট:
      - `sourceBranchId`
      - `targetBranchId`
      - `items: [{ variantId, quantity }]`
    - ভেতরে:
      - `transfers.service.ts` এর `createTransfer(...)` কল হবে।

#### ৬.২ Draft Transfer তৈরি – ধারণা

- Controller লেভেলে:

```ts
// pseudo (transfers.controller.ts এর ভিতরে নতুন handler)
async function createTransferFromSuggestions(req, res) {
  const { fromBranchId, toBranchId, items } = req.body;
  const userId = req.user.id;

  // items: [{ variantId, quantity }]

  const transfer = await transfersService.createTransfer({
    fromLocationId: fromBranchId, // InventoryLocation mapping
    toLocationId: toBranchId,
    items,
    createdByUserId: userId,
  });

  return res.json({ success: true, data: transfer });
}
```

- পরবর্তী ধাপ:
  - Owner/Manager UI থেকে existing transfer screen-এর মাধ্যমে `sendTransfer(...)` ও `receiveTransfer(...)` ফ্লো follow করবে (ইতিমধ্যেই ইমপ্লিমেন্টেড)।

---

### ৭. Fraud ও কন্ট্রোল কনসিডারেশন (ব্যাকএন্ড)

- সব transfer event (create/send/receive) ইতিমধ্যেই ledger + audit-এ ধরা হচ্ছে (`StockLedger`, `stock_transfers`) – এক্সপায়ারি-সাজেশন ফিচারও একই flow ব্যবহার করবে।
- নতুন **expiry-suggestion API**:
  - শুধুমাত্র উপযুক্ত role (Owner/Org Admin/Inventory Manager) এর জন্য অনুমোদিত হবে।
  - শুধু suggestion দেয়; stock movement সবসময় transfer workflow-এর মধ্য দিয়ে যাবে।
- Negative stock block:
  - `sendTransfer(...)` এর ভিতরে,
    - `ledgerService.getStockBalance` দিয়ে `onHandQty` চেক করে, পর্যাপ্ত না থাকলে error ছুড়ে দেয় (already implemented)।

---

### ৮. সারাংশ

- **মডেল ম্যাপিং**:
  - Business কনসেপ্ট `StockTransferOrder` → বিদ্যমান `StockTransfer` + `StockTransferItem`
  - Batch/Variant লেভেল ইনভেন্টরি → `Inventory` + `StockBalance` + `ProductVariant`
  - Preference কনফিগারেশন → ভবিষ্যৎ Prisma মডেল `BranchProductPreference` (concept)
- **রুল ইঞ্জিন**:
  - `getExpiringItems` + branch preference + simple rule দিয়ে `ExpiryTransferSuggestion[]` তৈরি।
  - Semi-auto: UI থেকে suggestion সিলেক্ট → `createTransfer(...)` দিয়ে draft তৈরি → পরের ধাপে send/receive।
- **নিরাপত্তা ও কন্ট্রোল**:
  - Role-based access, ledger-based tracking, negative stock protection – সব বিদ্যমান গার্ডদের উপর নির্মিত।

