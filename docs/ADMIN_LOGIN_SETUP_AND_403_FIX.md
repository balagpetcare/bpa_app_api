# Admin (Super Admin) Login Setup & 403 Fix

## সমস্যার সারসংক্ষেপ (Summary of issues)

1. **POST `/api/v1/admin/auth/login` → 403 Forbidden**  
   অ্যাডমিন লগইন API কল করলে 403 আসছে।

2. **কমন লগইন দিয়ে লগইন করলে অ্যাডমিন ড্যাশবোর্ডে Forbidden**  
   সাধারণ লগইন সফল, কিন্তু অ্যাডমিন প্যানেলে ঢুকলে 403 এবং `/admin/forbidden`।

3. **অ্যাডমিন ড্যাশবোর্ড API গুলো 403**  
   `GET /api/v1/admin/dashboard/live-feed`, `alerts`, `sla`, `trends`, `auth/me` ইত্যাদি 403 দিচ্ছে।

---

## কারণ (Root causes)

### 1. অ্যাডমিন হোয়াইটলিস্ট (Admin whitelist)

- অ্যাডমিন লগইন এবং অ্যাডমিন রাউট দুটোই **শুধুমাত্র হোয়াইটলিস্টে থাকা ইউজার** দিয়ে কাজ করে।
- লগইন স্টেপে: `performUnifiedLogin(..., { adminOnly: true })` → `isAdminAllowed(userId)` চেক।
- লগইনের পর প্রতিটি অ্যাডমিন API-তে: `requireAdmin` মিডলওয়্যার → `isAdminUser(userId)` চেক।
- আপনার টোকেনে `"perms":[]` এবং user id আছে; অ্যাডমিন অ্যাক্সেস শুধু **ইউজার আইডি নয়**, **ইমেইল/ফোন হোয়াইটলিস্ট** দিয়ে নির্ধারিত হয়।

যদি লগইন করা অ্যাকাউন্টের ইমেইল/ফোন হোয়াইটলিস্টে না থাকে:

- অ্যাডমিন লগইন API সরাসরি **403** দেবে (লগইনই হবে না)।
- অথবা কমন লগইন দিয়ে লগইন করলে টোকেন থাকবে, কিন্তু অ্যাডমিন রাউটে `requireAdmin` সেই ইউজারকে অ্যাডমিন হিসেবে মানবে না → **403**।

### 2. অ্যাডমিন ফ্লো না ব্যবহার করা

- সুপার অ্যাডমিনের জন্য রাউট: **`http://localhost:3103/login`** ব্যবহার করতে চাচ্ছেন।
- এই পেজে **`app=admin`** বা **`returnTo`-তে `/admin`** না থাকলে লগইন ফর্ম **কমন লগইন API** (`/api/v1/auth/login`) কল করে, **অ্যাডমিন লগইন API** (`/api/v1/admin/auth/login`) নয়।
- তাই হোয়াইটলিস্ট চেক লগইন স্টেপে হয় না, কিন্তু পরে অ্যাডমিন পেজে ঢুকলে `requireAdmin` চেক করে 403 দেয়।

### 3. API বেস ও কুকি (Frontend API base & cookie)

- অ্যাডমিন ড্যাশবোর্ড (ও অন্যান্য পেজ) `lib/api.ts` এর `apiGet`/`apiPost` ব্যবহার করে।
- সেখানে `base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000"` থাকায় সব রিকোয়েস্ট **সরাসরি `localhost:3000`** এ যাচ্ছে।
- ফ্রন্ট অ্যাপ চলে `localhost:3103` এ। তাই অ্যাডমিন রিকোয়েস্টগুলো **cross-origin** (পোর্ট ভিন্ন)।
- কুকি `Domain=localhost` দিয়ে সেট হলেও কিছু ব্রাউজার/সিচুয়েশনে cross-origin রিকোয়েস্টে কুকি নাও যেতে পারে; অথবা একই টোকেন দিয়েও হোয়াইটলিস্ট চেকে ইউজার অ্যাডমিন না হলে 403 আসবে।

সব রিকোয়েস্ট যদি **সেই অরিজিন দিয়ে** যায় যেখানে অ্যাপ চলছে (যেমন `http://localhost:3103`), তাহলে Next.js এর rewrite দিয়ে ব্যাকএন্ডে যাবে এবং কুকি নিশ্চিতভাবে যাবে। তাই অ্যাডমিন (ও অন্যান্য প্যানেল) সেটআপে **ব্রাউজারে same-origin API বেস** ব্যবহার করা জরুরি।

---

## সমাধান (Solutions)

### স্টেপ ১: ব্যাকএন্ডে অ্যাডমিন হোয়াইটলিস্ট সেট করা

**Option A – Env ভেরিয়েবল (টেবিল খালি থাকলে বা ফ্যালব্যাক)**

`.env` এ নিশ্চিত করুন (ইমেইল/ফোন যেগুলো সুপার অ্যাডমিন হবে সেগুলো দিন):

```env
# যেকোনো একটি বা দুটো ব্যবহার করা যায়
ADMIN_EMAILS=your-admin@example.com,another@example.com
ADMIN_PHONES=017777889994,01701022274

# অথবা সুপার অ্যাডমিন স্পেসিফিক নামে
SUPER_ADMIN_WHITELIST_EMAILS=balag@bangladeshpetassociation.com,admin@bangladeshpetassociation.com
SUPER_ADMIN_WHITELIST_PHONES=017777889994,01701022274

# অথবা শুধু ইউজার আইডি (নম্বর কমা দিয়ে)
ADMIN_USER_IDS=1,2
```

- `authUnified.service.ts` এর `isAdminAllowed()` এবং `admin.middleware.ts` এর `isAdminUser()` **দুটোই** প্রথমে DB এর `SuperAdminWhitelist` টেবিল দেখে; টেবিলে row থাকলে শুধু সেখান থেকে মিল খোঁজে।
- টেবিল খালি থাকলে বা মিল না থাকলে env ফ্যালব্যাক ব্যবহার হয়: `ADMIN_EMAILS`, `ADMIN_PHONES`, `ADMIN_USER_IDS` (এবং `SUPER_ADMIN_WHITELIST_*` যেখানে সাপোর্ট করা হয়েছে)।

**Option B – DB টেবিল (প্রডাকশনের জন্য ভালো)**

- সিডার আছে: `prisma/seeders/seedSuperAdminWhitelist.ts`  
  এটি env থেকে `SUPER_ADMIN_WHITELIST_EMAILS` ও `SUPER_ADMIN_WHITELIST_PHONES` নিয়ে `SuperAdminWhitelist` টেবিল ভরবে।
- সিড রান করুন এবং উপরের env গুলো সেট করে নিন।

লগইন করা অ্যাকাউন্টের **ইমেইল বা ফোন** (অথবা ইউজার আইডি, যদি `ADMIN_USER_IDS` ব্যবহার করেন) এই হোয়াইটলিস্টে থাকতে হবে; নাহলে লগইন বা অ্যাডমিন API দুটোই 403 দেবে।

### স্টেপ ২: সুপার অ্যাডমিন লগইনের জন্য সঠিক URL ব্যবহার করা

সুপার অ্যাডমিন লগইন যাতে **অ্যাডমিন লগইন API** দিয়ে হয়, তার জন্য যেকোনো একটি ব্যবহার করুন:

- **`http://localhost:3103/admin/login`**  
  এই পেজ অটো রিডাইরেক্ট করে `http://localhost:3103/login?app=admin&returnTo=...` এ। সেখানে ফর্ম জমা দিলে `POST /api/v1/admin/auth/login` কল হবে।
- অথবা সরাসরি: **`http://localhost:3103/login?app=admin`**  
  তাহলেও একই অ্যাডমিন লগইন API ব্যবহার হবে।

শুধু **`http://localhost:3103/login`** (কোনো `app=admin` বা `/admin` returnTo ছাড়া) ব্যবহার করলে কমন লগইন API চলবে; সেই ইউজার হোয়াইটলিস্টে না থাকলে পরে অ্যাডমিন প্যানেলে 403 পাবেন।

### স্টেপ ৩: ফ্রন্টএন্ডে API বেস – ব্রাউজারে same-origin (করা হয়েছে)

- **`bpa_web/lib/api.ts`**: ব্রাউজারে `base = ""` ব্যবহার করা হয় যাতে সব API কল same-origin (যেমন `http://localhost:3103/api/v1/...`) হয়। Next.js rewrite সেগুলো ব্যাকএন্ডে পাঠায় এবং কুকি সঠিকভাবে যায়।
- **`bpa_web/app/login/page.jsx`**: পোর্ট 3103 এ থাকলে লগইন পেজ ডিফল্টভাবে অ্যাডমিন ফ্লো ধরে; লগইনের পর রিডাইরেক্ট `/admin` হয়। ফলে `http://localhost:3103/login` সরাসরি সুপার অ্যাডমিন লগইনের জন্য ব্যবহার করা যায়।

### স্টেপ ৪: পরীক্ষা

1. `.env` এ হোয়াইটলিস্ট সেট/সিড করুন।
2. ব্যাকএন্ড রিস্টার্ট করুন।
3. ব্রাউজারে **`http://localhost:3103/login`** অথবা **`http://localhost:3103/admin/login`** খুলে সেই হোয়াইটলিস্টের ইমেইল/পাসওয়ার্ড দিয়ে লগইন করুন।
4. অ্যাডমিন ড্যাশবোর্ড ও `GET /api/v1/admin/auth/me` ইত্যাদি 403 ছাড়া কাজ করা উচিত।

---

## টাচ পয়েন্টস (Affected files)

| ফাইল | পরিবর্তন |
|------|----------|
| `backend-api/.env` | `ADMIN_EMAILS` / `ADMIN_PHONES` বা `SUPER_ADMIN_WHITELIST_*` / `ADMIN_USER_IDS` সেট করা |
| `backend-api` সিড | প্রয়োজনে `seedSuperAdminWhitelist` রান |
| `bpa_web/lib/api.ts` | ব্রাউজারে `base = ""` (same-origin) – **করা হয়েছে** |
| `bpa_web/app/login/page.jsx` | পোর্ট 3103 এ ডিফল্ট অ্যাডমিন ফ্লো + লগইনের পর `/admin` – **করা হয়েছে** |

---

## রেফারেন্স

- অ্যাডমিন লগইন: `backend-api/src/api/v1/modules/admin_auth/admin_auth.controller.ts` → `performUnifiedLogin(..., { adminOnly: true })`
- হোয়াইটলিস্ট চেক (লগইন): `backend-api/src/api/v1/services/authUnified.service.ts` → `isAdminAllowed()`
- হোয়াইটলিস্ট চেক (রাউট): `backend-api/src/middleware/admin.middleware.ts` → `isAdminUser()`
- সেন্ট্রাল লগইন পেজ: `bpa_web/app/login/page.jsx` → `isAdminFlow = app === 'admin' || returnTo.includes('/admin')`
- অ্যাডমিন লগইন রিডাইরেক্ট: `bpa_web/app/admin/login/page.tsx` → `AuthRedirectPage` → `getAuthRedirectUrl(..., 'admin')` → `/login?app=admin&returnTo=...`
