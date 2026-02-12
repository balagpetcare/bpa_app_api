# Hub-based Fulfilment — Sanity Check + Edge Case (বাংলা)

## ১) স্টক ডাবল-কাউন্ট যাচাই

| ফ্লো | ফলাফল | ব্যাখ্যা |
|------|--------|----------|
| **ONLINE order create** | **OK** | শুধু `orders.controller.ts` createOrder: `resolvedLocationId != null && source` থাকলে কেবল ledger (saleFEFO); অন্যথায় শুধু legacy inventory। একই অর্ডারে দুটো path চালু হয় না। |
| **POS sale** | **OK** | স্টক ডিডাক্ট শুধু `pos.service.ts`-এ — `orderService.createOrder` HTTP দিয়ে যায় না, তাই `orders.controller` createOrder একদম চালু হয় না। POS শুধু ledger অথবা legacy একটাই ব্যবহার করে। |
| **Cancel order restore** | **OK** | ক্যানসেলের পর রিস্টোর: `fulfilmentInventoryLocationId != null` থাকলে শুধু ledger restore; নাহলে শুধু legacy adjustStock। একসাথে দুটো চালু হয় না। |

---

## ২) অর্ডার ক্রিয়েশনে ডিডাক্ট টাইমিং

| বিষয় | অবস্থা | প্রস্তাব |
|--------|--------|----------|
| **কখন ডিডাক্ট** | **Create-এ** | অর্ডার create হওয়ার পরেই স্টক কাটা হয় (payment/confirm-এর আগে)। |
| **Pending/abandoned** | **সুপারিশ (মিনিমাল)** | পেন্ডিং অর্ডার স্টক ধরে রাখে; ক্যানসেল করলে রিস্টোর হয়। ভবিষ্যতে চাইলে: (ক) পেন্ডিং অর্ডার টাইমআউট পর স্টক রিলিজ জব, অথবা (খ) স্টক ডিডাক্ট শিফট করে payment/confirm-এ (বড় পরিবর্তন)। এখন কোনো কোড পরিবর্তন নয়, শুধু নীতি। |

---

## ৩) আইডেমপটেন্সি — ক্যানসেল দুইবার

| বিষয় | ফলাফল | ব্যাখ্যা |
|--------|--------|----------|
| **দ্বিতীয় ক্যানসেল** | **OK (প্যাচ পর)** | ইতিমধ্যে CANCELLED থাকলে আর throw নয়; অর্ডার রিটার্ন { order, performedCancel: false }। রিস্টোর শুধু performedCancel === true হলে। দ্বিতীয় ক্যানসেল ২০০ + "Order already cancelled"; স্টক কখনো দুইবার রিস্টোর হয় না। |

---

## ৪) RBAC — STAFF/TEAM

| এন্ডপয়েন্ট | ফলাফল | ব্যাখ্যা |
|-------------|--------|----------|
| **GET /api/v1/owner/hubs** | **OK** | `ownerPanelGuard`-এ `allowedRoles = ["OWNER","ADMIN","STAFF","TEAM"]`; STAFF/TEAM ৪০৩ পায় না। `getHubs` `getEffectiveBranchIdsForOwnerPanel` ব্যবহার করে তাই স্কোপ সঠিক। |
| **GET /api/v1/orders** | **OK** | শুধু `authenticateToken`; ৪০৩ এই রাউটে নেই। STAFF-এর জন্য `branchMember` থেকে branchId নেওয়া হয়, তাই নিজ ব্রাঞ্চের অর্ডার দেখে। |

---

## ৫) প্রয়োগকৃত প্যাচ (শুধু পরিবর্তিত অংশ)

### প্যাচ ১: ক্যানসেল আইডেমপটেন্সি — ইতিমধ্যে CANCELLED হলে ২০০ রিটার্ন, রিস্টোর না করা

**ফাইল: `backend-api/src/api/v1/modules/orders/orders.service.ts`**

- **কেন:** ক্যানসেল দুইবার কল করলে স্টক একবারই রিস্টোর হবে; দ্বিতীয়বার ২০০ রিটার্ন।

```diff
 async function cancelOrder(orderId: number, reason?: string, branchId?: number) {
   const where: any = { id: orderId };
   if (branchId) {
     where.branchId = branchId;
   }

   const existing = await prisma.order.findFirst({ where });
   if (!existing) {
     throw new Error("Order not found");
   }

-  if (existing.status === "DELIVERED" || existing.status === "CANCELLED") {
-    throw new Error(`Cannot cancel order with status: ${existing.status}`);
-  }
+  if (existing.status === "DELIVERED") {
+    throw new Error(`Cannot cancel order with status: ${existing.status}`);
+  }
+  if (existing.status === "CANCELLED") {
+    const alreadyCancelled = await prisma.order.findFirst({
+      where: { id: orderId },
+      include: {
+        branch: true,
+        customer: true,
+        items: { include: { product: true, variant: true } },
+      },
+    });
+    return { order: alreadyCancelled, performedCancel: false };
+  }

   const order = await prisma.order.update({
     ...
   });

-  return order;
+  return { order, performedCancel: true };
 }
```

**ফাইল: `backend-api/src/api/v1/modules/orders/orders.controller.ts`**

- **কেন:** শুধু `performedCancel === true` হলে রিস্টোর চালাতে হবে; আইডেমপটেন্সি বজায়।

```diff
-    const order = await service.cancelOrder(orderId, reason, branchId);
+    const result = await service.cancelOrder(orderId, reason, branchId);
+    const order = result.order;
+    const performedCancel = result.performedCancel === true;

-    if (order.status === "CANCELLED" && order.fulfilmentInventoryLocationId != null && order.items?.length) {
+    if (performedCancel && order.status === "CANCELLED" && order.fulfilmentInventoryLocationId != null && order.items?.length) {
       const restoreItems = ...
         await ledgerService.restoreStockForOrderCancel({...});
       }
-    } else if (order.status === "CANCELLED") {
+    } else if (performedCancel && order.status === "CANCELLED") {
       for (const item of order.items) {
         ...
       }
     }

     return res.status(200).json({
       success: true,
       data: order,
-      message: "Order cancelled successfully",
+      message: performedCancel ? "Order cancelled successfully" : "Order already cancelled",
     });
```

---

## ৬) আপডেটেড FINAL CHECKLIST

**Backend (bpa_app_api):**
- [x] `prisma/schema.prisma` — Order fulfilment + OrderSource
- [x] `prisma/migrations/...` — migration
- [x] `src/api/v1/modules/orders/orders.service.ts` — getOrders/getOrderById/createOrder/cancelOrder + getDefaultFulfilmentLocationForBranch; **cancelOrder idempotent (already CANCELLED → { order, performedCancel: false })**
- [x] `src/api/v1/modules/orders/orders.controller.ts` — createOrder validation + ledger deduct; cancelOrder **শুধু performedCancel হলে রিস্টোর**; message "Order already cancelled" when idempotent
- [x] `src/api/v1/modules/inventory/ledger.service.ts` — SALE_CLINIC, restoreStockForOrderCancel
- [x] `src/api/v1/modules/pos/pos.service.ts` — SHOP resolve + ledger/legacy deduct
- [x] `src/api/v1/modules/owner/owner.controller.ts` — getHubs
- [x] `src/api/v1/modules/owner/owner.routes.ts` — GET /hubs

**Frontend (web_app):** (অপরিবর্তিত)
- [x] `app/owner/_lib/ownerApi.ts` — getOwnerHubs
- [x] `app/owner/orders/page.tsx` — হাব কলাম + ফিল্টার
- [x] `app/owner/orders/[id]/page.tsx` — Fulfilment Hub + পুরনো অর্ডার

**Sanity / Edge:**
- [x] স্টক ডাবল-কাউন্ট নেই (ONLINE / POS / Cancel)
- [x] ডিডাক্ট টাইমিং: create-এ; abandoned order হ্যান্ডলিং নীতি ডকুমেন্টে
- [x] ক্যানসেল দুইবার: রিস্টোর একবার; দ্বিতীয়বার ২০০ + "Order already cancelled"
- [x] GET /owner/hubs ও GET /orders — STAFF/TEAM ৪০৩ না
