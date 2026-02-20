# Global-Ready Product System Documentation

**BPA Product Ecosystem – World-Scale Design**

*(This document is aligned with [BPA_STANDARD.md](../BPA_STANDARD.md) and [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md). Ports, merge policy, and touch-point rules must not be violated.)*

---

## 1. ডকুমেন্টেশনের উদ্দেশ্য (Purpose)

এই ডকুমেন্টের লক্ষ্য:

- সারা বিশ্বের জন্য **একটাই Core Product System**
- **Country-wise** নিয়ম, আইন, কাস্টমাইজেশন শুধু Policy দিয়ে
- ফেক প্রোডাক্ট, কপি, গ্রে মার্কেট রোধ
- মাল্টি-কান্ট্রি প্রোডাকশন হাউজ সাপোর্ট
- ভবিষ্যতে AI, Automation, Blockchain-ready রাখা

ডেভেলপাররা এই ডক অনুসরণ করে:

- DB Design করতে পারবে
- API Flow বুঝবে
- Permission ও Control Layer implement করতে পারবে
- Future update-এ কিছু **ভাঙবে না** (backward compatible)

---

## 2. Core Design Philosophy (সবচেয়ে গুরুত্বপূর্ণ)

### “One Global Core + Country Controlled Layers”

```
Global Core (Immutable)
│
├── Country Layer (Policy Driven)
│   ├── Product Rules
│   ├── Tax / VAT
│   ├── Import / Export
│   ├── Donation & Fund Rules
│
├── Organization Layer
│   ├── Manufacturer
│   ├── Importer
│   ├── Distributor
│
└── Branch / Production Unit
```

- **Core কখনো ভাঙা যাবে না**
- Country Layer শুধু **config + rule** দিয়ে কাজ করবে (কোড change ছাড়া)

---

## 3. Product System – High-Level Architecture

### Main Components

| # | Component | উদ্দেশ্য |
|---|-----------|----------|
| 1 | **Global Product Registry (GPR)** | পৃথিবীর যেকোনো প্রোডাক্ট একবারই global ভাবে define; manufacturer edit করতে পারবে না |
| 2 | **Manufacturer Identity & Trust System** | Company/Legal Entity/Production Unit; লাইসেন্স, ট্রাস্ট স্কোর |
| 3 | **Secure Product Serialization Engine** | ইউনিট/ব্যাচ/কার্টন সিরিয়াল; কপি/প্রেডিক্ট করা অসম্ভব |
| 4 | **Country Policy Engine** | দেশভিত্তি allowed categories, max serial, donation/tax/export rules |
| 5 | **Supply Chain Visibility Layer** | Factory → Distributor → Shop → Customer; প্রতিটি ধাপে scan + location + ownership |
| 6 | **Consumer Verification System** | User scan করলে authentic/origin/expiry; duplicate scan = red alert |
| 7 | **Audit, AI & Fraud Detection** | প্রতিটি serial/scan/transfer লগ; unusual pattern detection |

---

## 4. Global Product Registry (GPR)

### উদ্দেশ্য

পৃথিবীর যেকোনো প্রোডাক্ট **একবারই** global ভাবে define হবে। Manufacturer এই তথ্য সরাসরি edit করতে পারবে না।

### Core Fields (Immutable once published)

| Field | Type | নিয়ম |
|-------|------|--------|
| global_product_id | UUID | একবার জেনারেট; কখনো পরিবর্তন নয় |
| brand_name | String | GPR থেকে; manufacturer change করতে পারবে না |
| product_name | String | GPR থেকে |
| category | FK / code | Pet product category |
| pet_type | Enum / code | dog, cat, bird, etc. |
| composition / ingredients | Text / JSON | AI lock এর অংশ |
| net_weight, packaging_type | As needed | |
| base_description | Text | **AI Locked** – manufacturer শুধু batch size, production date, expiry দিতে পারবে |
| created_by | Admin ref | শুধু admin create করবে |
| created_at | DateTime | |

- এই তথ্য **country অনুযায়ী duplicate** করা যাবে না (এক global product = এক রেকর্ড).
- বর্তমান সিস্টেমে MasterProductCatalog (prisma schema) আছে – GPR হলো এর **evolution**: `global_product_id` (UUID), description lock, admin-only create/edit policy.

### বর্তমান vs টার্গেট

| বর্তমান (MasterProductCatalog) | টার্গেট (GPR) |
|---------------------------------|---------------|
| id (int), slug, barcode | global_product_id (UUID), barcode unique global |
| companyId, brandId, description editable | Description **locked**; manufacturer only batch/date/expiry |
| isVerified | + created_by (admin only), immutable after publish |

---

## 5. Manufacturer / Company Identity System

### সমস্যা

একই কোম্পানির একাধিক দেশ, একাধিক প্রোডাকশন হাউজ, একাধিক লাইসেন্স – সব আলাদা করে চেনা ও ট্রাস্ট মাপা দরকার।

### সমাধান: Multi-Layer Identity

```
Company (Global)
│
├── Legal Entity (Country wise)
│   ├── Licenses
│   ├── Compliance Docs
│
├── Production Units
│   ├── Factory ID
│   ├── Geo Location
│   ├── Capacity
```

### Trust Score System

- License validity
- Production history
- Audit reports
- Complaint ratio

**Trust Score কমলে** → Serial generation limit auto কমে যাবে (policy দিয়ে)।

### বর্তমান vs টার্গেট

| বর্তমান (Company) | টার্গেট |
|--------------------|---------|
| id, name, country (string), website, description | Company (global) + LegalEntity (country_id, licenses, compliance) |
| – | ProductionUnit (factory_id, geo, capacity) |
| – | TrustScore / TrustLevel per LegalEntity or ProductionUnit |

---

## 6. Secure Product Serialization Engine (সবচেয়ে গুরুত্বপূর্ণ)

### পুরোনো সমস্যা

- সিরিয়াল কপি
- QR duplicate
- ফেক প্রোডাক্ট

### BPA Solution

প্রতিটি ইউনিটে:

```
GLOBAL_PRODUCT_ID
+ COUNTRY_CODE
+ MANUFACTURER_ID
+ FACTORY_ID
+ BATCH_ID
+ RANDOM_NONCE
+ SIGNATURE (HMAC / ECC)
```

### Serial Types

| Type | ব্যবহার |
|------|---------|
| Unit Serial | প্রতিটি বিক্রয়যোগ্য ইউনিট |
| Batch Serial | এক ব্যাচের সব ইউনিট রেফার |
| Carton Serial | কার্টন লেভেল ট্র্যাকিং |
| Pallet Serial | প্যালেট লেভেল ট্র্যাকিং |

নিয়ম:

- Serial **কখনো predictable** হবে না
- **Re-generate** করা যাবে না (একবার জেনারেট = চিরস্থায়ী)
- জেনারেশন **শুধু সার্ভার সাইড**; ক্লায়েন্টে কোনো ট্রাস্ট নয়

### বর্তমান

- বর্তমানে Product/ProductVariant এ `sku`, `barcode` আছে – **unit-level cryptographically secure serial** নেই। এই ইঞ্জিন নতুন টেবিল/সার্ভিস হিসেবে যোগ করতে হবে (existing Product ভাঙবে না)।

---

## 7. Product Description Lock System (Anti-Abuse)

> “একই প্রোডাক্ট বারবার বেশি সিরিয়াল নিতে পারবে না” – description match না হলে সিরিয়াল জেনারেশন বন্ধ।

### Implementation

- **Global Product Description = AI Locked** (GPR এ একবার set; manufacturer change করতে পারবে না)
- Manufacturer শুধু দিতে পারবে:
  - Batch size
  - Production date
  - Expiry date

যদি request করা প্রোডাক্টের description GPR এর সাথে **match না করে**:

- Serial generation **না** করা হবে
- Alert + Manual review

(বাস্তবে: serial request এর সময় GPR snapshot বা hash match চেক; mismatch = deny + audit log)

---

## 8. Country Policy Engine (Config-Driven)

প্রতিটি দেশের জন্য আলাদা policy (কোড change ছাড়া):

| Area | উদাহরণ |
|------|--------|
| allowed_categories | কোন ক্যাটাগরি এই দেশে চালু |
| max_serial_per_month | প্রোডাকশন ইউনিট অনুযায়ী লিমিট |
| donation_rules | Donation ON/OFF, receive/send only |
| tax_rules | VAT/Tax rate বা rule ref |
| export_restrictions | কোন প্রোডাক্ট/ক্যাটাগরি export নিষিদ্ধ |
| scan_visibility | Consumer কে কি কি দেখাবে (authentic, origin, expiry ইত্যাদি) |

### Feature Toggle (Country-wise)

- Donation ON/OFF
- Adoption ON/OFF
- Fund Receive Only / Send Only
- Product category ban

বিস্তারিত টেবিল ডিজাইন [Country Policy Engine Design](./COUNTRY_POLICY_ENGINE_DESIGN.md) (বা Global-Ready Master Doc) এ থাকবে। এখানে Product-specific: **allowed_categories**, **max_serial_per_month**, **export_restrictions** policy থেকে পড়ে নিতে হবে।

---

## 9. Supply Chain Visibility (End-to-End)

```
Factory → Distributor → Shop → Customer
```

প্রতিটি ধাপে:

- **Scan required** (serial + location)
- **Location logged**
- **Ownership transferred** (ledger/event)

Admin দেখতে পারবে:

- কোন প্রোডাক্ট কোন দেশে
- কোথায় diversion হয়েছে
- গ্রে মার্কেট শনাক্ত

### বর্তমান

- Inventory, StockLedger, StockTransfer আছে – **serial-level** এবং **country/location + ownership chain** পুরো ফ্লো এখনো নয়। Supply chain layer টেবিল ও API এই ডক অনুযায়ী ধাপে ধাপে যোগ করতে হবে।

---

## 10. Consumer Verification System

### User Scan করলে দেখাবে

- Product Authentic?
- Manufacturer
- Country of origin
- Production unit
- Import path
- Expiry

### Duplicate scan / Abuse

- **Duplicate scan** → Red alert
- **Geo mismatch** (প্রথম scan দেশ A, দ্বিতীয় scan দেশ B অল্প সময়ে) → Investigation trigger
- সব scan ইভেন্ট অডিট লগে; কখনো delete না

---

## 11. Fraud, Audit & AI Layer

### AI Capabilities (Planned)

- Unusual serial request detection
- Factory capacity vs serial count
- Cross-country diversion pattern
- Fake distributor detection

### Audit Trail

- Every serial (generate, assign, transfer)
- Every scan (success, duplicate, fail)
- Every transfer (from-to, quantity, serial range)

নিয়ম: **No delete, only append.**

বর্তমান AuditLog এ entity type শুধু ORGANIZATION, BRANCH, OWNER_KYC – Product/Serial/Scan/Transfer এর জন্য নতুন entity type ও লগ স্ট্রাকচার যোগ করতে হবে।

---

## 12. Developer Mandatory Instructions (টিমকে দেবেন)

### Non-Negotiable Rules

| নিয়ম | বিস্তার |
|-------|---------|
| Core Product Table modify করা যাবে না (breaking) | GPR/ MasterProductCatalog এর core fields rename/remove করবেন না; শুধু additive change (নতুন column, নতুন টেবিল) |
| Global Product delete করা যাবে না | Soft delete / status = RETIRED allowed; hard delete নয় |
| Country behavior only via Policy Engine | দেশভিত্তি নিয়ম শুধু policy টেবিল/কনফিগ থেকে; হার্ডকড country if/else নয় |
| Every action must be logged | Serial generate, scan, transfer, policy check – relevant audit event লিখতে হবে |
| Serial generation = server-side only | ক্লায়েন্ট কখনো serial বা signature জেনারেট করবে না |
| No client-side trust | Verification সব সার্ভার সাইড; ক্লায়েন্ট শুধু display |

### BPA Standard মেনে চলুন

- [BPA_STANDARD.md](../BPA_STANDARD.md): পোর্ট পরিবর্তন নয়; কোড merge করতে হবে, overwrite নয়; ছোট প্যাচ; টাচ পয়েন্ট আগে নিশ্চিত করুন।
- [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md): Backward compatible change; update-only patch পছন্দনীয়।

### Workflow

1. **টাচ পয়েন্ট লিস্ট করুন** – কোন ফাইল/টেবিল/API পরিবর্তন হবে আগে লিখুন।
2. **মাইগ্রেশন প্রথম** – schema change তারপর সিড/এপিআই।
3. **পরে API ও সার্ভিস** – policy check, serial engine, audit একসাথে ধরুন।
4. **টেস্ট** – policy on/off, limit, duplicate scan, geo mismatch সিনারিও টেস্ট করুন।

---

## 13. Future-Ready (Optional but Planned)

- Blockchain anchoring (hash only) – serial/ batch hash anchor
- Customs API integration – দেশভিত্তি
- Government verification portal – read-only access for authority
- AI-based demand & fraud forecasting

---

## 14. বর্তমান সিস্টেমে যা আছে – সংক্ষিপ্ত ম্যাপ

| যা আছে | কোথায় | টার্গেটের সাথে সম্পর্ক |
|--------|--------|-------------------------|
| Company | prisma: companies | Global Company; LegalEntity + ProductionUnit + Trust যোগ করতে হবে |
| Brand | prisma: brands | Company under; ঠিক আছে |
| MasterProductCatalog | prisma: master_product_catalog | GPR এর বেস; global_product_id (UUID), description lock, admin-only policy যোগ |
| Product | prisma: products | Branch/Org level “clone”; serial না থাকলে আগে যেমন আছে চলবে; serial থাকলে GPR + Serial Engine এর সাথে লিংক |
| ProductVariant | prisma: product_variants | sku, barcode – Unit Serial লেভেলে extend (নতুন টেবিল বা ফিল্ড যেন ভাঙে না) |
| Inventory, StockLedger, StockTransfer | prisma | Supply chain visibility তে serial + location + ownership chain যোগ |
| AuditLog | prisma: audit_logs | Entity type এ Product, Serial, Scan, Transfer যোগ |

---

## 15. Final Note

এই Product System ডিজাইন এমন যে:

- Google/Amazon-level global deployment possible
- Government-friendly (policy-driven, audit, no delete)
- Legal-safe (country rules via config)
- Future-proof (AI, blockchain, customs hook রাখা যায়)

ডকুমেন্টটি ডেভেলপারদের সাথে শেয়ার করে **কি বানাতে হবে, কেন বানাতে হবে, আর কীভাবে বানাতে হবে** – তিনটাই এই এক ডক থেকে আলোচনা ও ইনস্ট্রাকশন দিতে পারবেন। যেকোনো নতুন ফিচার এই নীতির সাথে সামঞ্জস্যপূর্ণ রাখুন যাতে ভবিষ্যতে ভাঙতে না হয়।

---

## Related Documentation

| ডক | বিষয় |
|----|--------|
| [BPA_STANDARD.md](../BPA_STANDARD.md) | পোর্ট, কোড চেঞ্জ পলিসি, টাচ পয়েন্ট |
| [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) | টেক স্ট্যাক, API বেস URL, নীতি |
| [COUNTRY_POLICY_ENGINE_DESIGN.md](./COUNTRY_POLICY_ENGINE_DESIGN.md) | Country Policy টেবিল ও রানটাইম (যদি থাকে) |
| [GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md) | Global-Ready প্ল্যাটফর্ম মাস্টার ডক (যদি থাকে) |
| প্ল্যান: Global-Ready Analysis ও স্টার্ট গাইডলাইন | ধাপে ধাপে Phase 1–2–3 ও চেকপয়েন্ট (প্ল্যান ডক সেকশন ৮) |
