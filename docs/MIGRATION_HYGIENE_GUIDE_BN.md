# Prisma Migration Hygiene Guide (বাংলা)

এই ডকুমেন্ট প্রোজেক্টে Prisma migration সংক্রান্ত নিয়ম, অডিট ফলাফল এবং ভবিষ্যতে "modified after applied", P3018, 42P07 (relation already exists) এড়ানোর গাইডলাইন।

---

## ১. Migration Hygiene Audit রিপোর্ট

### ১.১ একই টেবিলে একই unique/index/constraint (duplicate intent)

| টেবিল | migration_name | file_path | creates | duplicates_with | risk_level |
|--------|----------------|-----------|---------|-----------------|------------|
| owner_delegations | 20260206195922_add_owner_delegation_tables | prisma/migrations/20260206195922_add_owner_delegation_tables/migration.sql | UNIQUE INDEX `owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key` (COALESCE for NULL) | 20260209222503 | **HIGH** (ফিক্স করা হয়েছে) |
| owner_delegations | 20260209222503_add_order_fulfilment_location_and_source | prisma/migrations/20260209222503_add_order_fulfilment_location_and_source/migration.sql | একই নামের UNIQUE INDEX (plain columns) | 20260206195922 | **HIGH** → **FIXED** (IF NOT EXISTS যোগ করা হয়েছে) |

### ১.২ owner_delegations টেবিল – unique/index কোথায় কোথায় আছে

| migration_name | file_path | কী তৈরি হয় |
|----------------|-----------|-------------|
| 20260206195922_add_owner_delegation_tables | prisma/migrations/20260206195922_add_owner_delegation_tables/migration.sql | টেবিল তৈরি + UNIQUE INDEX `owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key` (COALESCE(orgId,-1), COALESCE(branchId,-1)) |
| 20260206200147_add_owner_delegation_tables | prisma/migrations/20260206200147_add_owner_delegation_tables/migration.sql | No-op (SELECT 1) – ইন্ডেক্স আগের মাইগ্রেশনে আছে |
| 20260207014527_owner_delegations_unique_key | prisma/migrations/20260207014527_owner_delegations_unique_key/migration.sql | No-op (কমেন্ট মাত্র) |
| 20260209222503_add_order_fulfilment_location_and_source | prisma/migrations/20260209222503_add_order_fulfilment_location_and_source/migration.sql | একই নামের UNIQUE INDEX আবার তৈরি করার চেষ্টা → **ফিক্স:** `CREATE UNIQUE INDEX IF NOT EXISTS` ব্যবহার |

### ১.৩ Migration SQL-এ hard-coded index/constraint নাম – repeated/collide মার্ক

| index/constraint নাম | প্রথম দেখা | পুনরায় দেখা | risk |
|----------------------|------------|-------------|------|
| owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key | 20260206195922 | 20260209222503 | **REPEATED** – ফিক্স করা (IF NOT EXISTS) |
| owner_teams_ownerUserId_name_key | 20260207180001 | – | IF NOT EXISTS ব্যবহার করা আছে, নিরাপদ |
| অন্যগুলো (team_invitations_tokenHash_key, location_cities_stateId_name_key ইত্যাদি) | বিভিন্ন মাইগ্রেশন | নেই | নরমাল |

### ১.৪ schema.prisma এর @@unique/@@index বনাম migration.sql

- `OwnerDelegation`: `@@unique([ownerUserId, delegatedUserId, scopeKey, orgId, branchId])`  
  Prisma এই নাম দেয়: `owner_delegations_ownerUserId_delegatedUserId_scopeKey_orgI_key`  
  এই নামই ২০২৬০২০৬১৯৫৯২২ এবং ২০২৬০২০৯২২২৫০৩ উভয় মাইগ্রেশনে ব্যবহার হয়েছে। পরে যেটি আবার create করছিল সেটিতে **IF NOT EXISTS** যোগ করে collision ঠিক করা হয়েছে।

---

## ২. স্থায়ী নিয়ম (Policy Guardrails)

### ২.১ Applied migration এডিট না করা (prod-safe)

- **প্রোড/স্টেজে যে মাইগ্রেশন ইতিমধ্যে apply করা হয়েছে, তার SQL বা নাম পরিবর্তন করবেন না।**
- পরিবর্তন করলে "The migration &lt;X&gt; was modified after it was applied" এবং shadow DB mismatch হতে পারে।
- **শুধু ডেভে** এবং শুধুমাত্র যখন reset-friendly করতে হবে (যেমন duplicate index এড়াতে IF NOT EXISTS) সেক্ষেত্রে পরামর্শ অনুযায়ী একবার ঠিক করা যেতে পারে; তারপর ওই মাইগ্রেশন আর এডিট না করা।

### ২.২ Duplicate index নাম এড়ানো

- নতুন মাইগ্রেশন লিখলে বা Prisma দিয়ে generate করলে চেক করুন: একই টেবিলে একই নামের UNIQUE INDEX বা CONSTRAINT আগের কোন মাইগ্রেশনে আছে কিনা।
- যদি থাকার সম্ভাবনা থাকে (যেমন schema-তে @@unique আছে কিন্তু ইতিমধ্যে custom migration-এ ওই নামে index আছে), তাহলে:
  - **CREATE UNIQUE INDEX IF NOT EXISTS** ব্যবহার করুন, অথবা
  - **DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;** দিয়ে constraint add করুন।

### ২.৩ Migration generate করার সঠিক পদ্ধতি

- **ডেভে নতুন মাইগ্রেশন:**  
  `npx prisma migrate dev --name your_descriptive_name`  
  একবার নাম দিয়ে generate করুন; পরে ওই মাইগ্রেশন ফাইল এডিট করবেন না (শুধু উপরের নিয়ম অনুযায়ী একবার safe guard দিলে যথেষ্ট)।
- **প্রোড/স্টেজে apply:**  
  `npx prisma migrate deploy`  
  শুধু deploy; নতুন মাইগ্রেশন generate করবেন না।

### ২.৪ owner_delegations ইউনিক – প্রম্পটে N দিন

- **যদি `migrate dev` চালানোর পর Prisma জিজ্ঞেস করে:**  
  *"A unique constraint covering the columns [ownerUserId,delegatedUserId,scopeKey,orgId,branchId] on the table owner_delegations will be added. Are you sure you want to create and apply this migration?"*
- **তখন অবশ্যই N (No) চাপুন।**  
  ওই ইউনিক ইন্ডেক্স ইতিমধ্যে ২০২৬০২০৬১৯৫৯২২ মাইগ্রেশনে (COALESCE দিয়ে) তৈরি আছে। নতুন মাইগ্রেশন তৈরি করলে একই নামে আবার create করার চেষ্টা হবে এবং 42P07 আসবে। N দিলে কোনো নতুন মাইগ্রেশন তৈরি হবে না, ডিবি ঠিক থাকবে।

### ২.৫ Mismatch / P3018 হলে কীভাবে resolve করবেন

- **প্রোড DB-তে migration fail (P3018):**  
  [Prisma: Resolve migration issues](https://pris.ly/d/migrate-resolve) অনুসরণ করুন।  
  সাধারণভাবে: `prisma migrate resolve --applied "migration_name"` বা `--rolled-back` ব্যবহার হয়।
- **ডেভে reset দরকার:**  
  `npx prisma migrate reset`  
  এখন ২০২৬০২০৯২২২৫০৩ মাইগ্রেশনে IF NOT EXISTS থাকায় একই নামের index আবার create হলে 42P07 আসবে না।

---

## ৩. সংক্ষিপ্ত চেকলিস্ট

- [ ] নতুন মাইগ্রেশন দেওয়ার আগে `npm run check:migrations` চালিয়ে duplicate index/constraint নেই দেখে নিন।
- [ ] Applied মাইগ্রেশন আর এডিট করবেন না (prod-safe)।
- [ ] যেখানে একই নামের index/constraint দ্বিতীয়বার create হতে পারে, সেখানে IF NOT EXISTS বা DO block ব্যবহার করুন।
- [ ] ডেভে: `npx prisma migrate dev`; প্রোড: `npx prisma migrate deploy`।

---

## ৪. সংশ্লিষ্ট স্ক্রিপ্ট

- **check-migration-collisions:**  
  `npm run check:migrations`  
  বিস্তারিত: `scripts/check-migration-collisions.js` – একই নামের `CREATE UNIQUE INDEX` / `ADD CONSTRAINT` একাধিক মাইগ্রেশনে আছে কিনা স্ক্যান করে।
