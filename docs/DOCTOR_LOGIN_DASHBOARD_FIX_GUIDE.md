# Doctor Login → Dashboard Fix – পূর্ণাঙ্গ গাইডলাইন

লগইনের পর ডাক্তার ড্যাশবোর্ডে যেতে না পারার সমস্যা ঠিক করতে এই গাইড অনুসরণ করুন। শুধুমাত্র ডাক্তার প্যানেল ফ্লোতে পরিবর্তন; অন্য প্যানেল/রাউট অপরিবর্তিত।

---

## ১. যা ইতিমধ্যে ইমপ্লিমেন্ট করা আছে (যাচাই করুন)

নিচের তিনটি পরিবর্তন প্ল্যান অনুযায়ী করা থাকা দরকার। না থাকলে আগে সেগুলো প্রয়োগ করুন।

### ১.১ Backend – default_redirect for doctor

**ফাইল:** `backend-api/src/api/v1/modules/auth/auth.controller.ts`

`/auth/me` হ্যান্ডলারে, `let default_redirect = await decideRedirect(userId, authContexts);` এর ঠিক পরেই এই লাইন থাকতে হবে:

```ts
if (panels.doctor === true) default_redirect = "/doctor/dashboard";
```

### ১.২ Frontend – PANEL_PATHS এ doctor

**ফাইল:** `bpa_web/app/post-auth-landing/page.tsx`

`PANEL_PATHS` অবজেক্টে এই এন্ট্রি থাকতে হবে:

```ts
doctor: "/doctor/dashboard",
```

(অন্যান্য প্যানেলের সাথে, যেমন `clinic: "/clinic"` এর পর।)

### ১.৩ Frontend – Doctor same-origin login

**ফাইল:** `bpa_web/lib/authRedirect.ts`

- **buildAuthUrl:** same-origin শর্তে `doctor` থাকতে হবে।  
  শর্তটি এমন: `(appName === 'admin' || appName === 'doctor')`
- **getAuthRedirectUrl:** ৪র্থ আর্গুমেন্ট: `panelName === 'admin' || panelName === 'doctor'`

এতে `3107/doctor/login` থেকে ইউজার `3107/login?app=doctor&returnTo=...` এ যাবে এবং লগইন একই পোর্টে (৩১০৭) হবে, তাই কুকি সঠিকভাবে সেট হবে।

---

## ২. সমস্যা এখনো থাকলে – চেকলিস্ট

### ২.১ ডাক্তার ভেরিফিকেশন (Backend / DB)

Backend এ **panels.doctor = true** হয় শুধুমাত্র যখন:

1. ইউজারের জন্য `ClinicStaffProfile` আছে যেখানে `staffType = "DOCTOR"` (এবং সেই প্রোফাইল `BranchMember` এর সাথে যুক্ত যে ইউজারই সেই মেম্বার), এবং  
2. সেই ইউজারের জন্য `DoctorVerification` রেকর্ড আছে এবং `verificationStatus = "VERIFIED"`।

যদি ভেরিফিকেশন VERIFIED না হয়, তাহলে `panels.doctor` false থাকবে এবং `default_redirect` ডাক্তার ড্যাশবোর্ডে যাবে না।

**কী করবেন:**

- Prisma/DB এ চেক করুন:
  - `ClinicStaffProfile`: সংশ্লিষ্ট ইউজারের `BranchMember` এর সাথে প্রোফাইল, `staffType: "DOCTOR"`।
  - `DoctorVerification`: সেই `userId` এর জন্য রেকর্ড এবং `verificationStatus: "VERIFIED"`।
- টেস্টের জন্য অ্যাডমিন প্যানেল থেকে ডাক্তার ভেরিফিকেশন অ্যাপ্রুভ করুন, অথবা ডাইরেক্ট DB এ স্ট্যাটাস VERIFIED সেট করুন।

### ২.২ লগইন কোন পোর্টে হচ্ছে

- ডাক্তার ড্যাশবোর্ড শুধুমাত্র **পোর্ট ৩১০৭** এ চালু থাকে (BPA স্ট্যান্ডার্ড)।
- লগইন **অবশ্যই ৩১০৭ এ** করতে হবে: `http://localhost:3107/login`  
  অথবা `http://localhost:3107/doctor/login` (যা ৩১০৭ এর same-origin `/login` এ রিডাইরেক্ট করবে)।
- যদি লগইন অন্য পোর্টে (যেমন ৩১০০) হয়, সেশন কুকি সেই পোর্টের জন্য সেট হবে; পরে ৩১০৭ এ গেলে কুকি পাঠানো নাও হতে পারে এবং ড্যাশবোর্ডে অ্যাক্সেস পাবেন না।

**কী করবেন:** ব্রাউজার এড্রেসবারে স্পষ্টভাবে `http://localhost:3107/login` লিখে লগইন করুন।

### ২.৩ পোস্ট-অথ ল্যান্ডিং কোন পোর্টে

- লগইন সফল হওয়ার পর যদি রিডাইরেক্ট হয় ` /post-auth-landing` এ, তাহলে সেই পেজটি **যে পোর্টে খুলছে** সেটাই গুরুত্বপূর্ণ।
- যদি সেটা **৩১০০** (মাদার অ্যাপ) হয়, তাহলে সেখানে `default_redirect` হিসেবে `/doctor/dashboard` পেলে বর্তমান কোড `router.replace("/doctor/dashboard")` করবে, অর্থাৎ **৩১০০/doctor/dashboard** – কিন্তু ডাক্তার অ্যাপ ৩১০৭ এ চলে, তাই ৩১০০ এ `/doctor` রাউট নাও থাকতে পারে।

**ইমপ্লিমেন্ট করা আছে:** পোস্ট-অথ ল্যান্ডিং এ `doRedirect` এর ভিতরে যখন পাথ `/doctor/` দিয়ে শুরু এবং বর্তমান পোর্ট ৩১০৭ না, তখন ফুল URL এ রিডাইরেক্ট করা হয় (`window.location.href = protocol//hostname:3107/path`) যাতে ইউজার ডাক্তার প্যানেল (৩১০৭) এ পৌঁছান।

### ২.৪ ডাক্তার ক্যান্ডিডেট (অবশেষে ভেরিফাইড নন)

যে ইউজারের ডাক্তার প্রোফাইল আছে কিন্তু ভেরিফিকেশন এখনো VERIFIED না (সাবমিটেড/পেন্ডিং), তাদের জন্য `panels.doctor` false। তাই তারা `default_redirect` এ `/doctor/dashboard` পাবেন না; তারা `/choose-activity` বা অনার ড্যাশবোর্ড পেতে পারেন।

**ইমপ্লিমেন্ট করা আছে:** Backend এ `/auth/me` এ ডাক্তার ক্যান্ডিডেটের জন্যও রিডাইরেক্ট সেট করা হয়েছে:

- `panels.doctor === true` → `default_redirect = "/doctor/dashboard"`
- এছাড়া যদি `doctorProfileCount > 0` এবং ভেরিফিকেশন স্ট্যাটাস `"VERIFIED"` না → `default_redirect = "/doctor/verification"`

তাহলে ডাক্তার ক্যান্ডিডেট লগইনের পর সরাসরি ডাক্তার ভেরিফিকেশন পেজে যাবে।

---

## ৩. স্টেপ-বাই-স্টেপ ভেরিকেশন

1. **Backend চালু** (পোর্ট ৩০০০) এবং **Doctor panel (bpa_web) চালু** পোর্ট ৩১০৭ এ।
2. DB এ নিশ্চিত করুন টেস্ট ইউজারের জন্য:
   - `ClinicStaffProfile` (staffType DOCTOR) + `DoctorVerification` (verificationStatus VERIFIED)।
3. ব্রাউজারে যান: `http://localhost:3107/login`  
   (সরাসরি ৩১০৭; ৩১০০ বা অন্য পোর্টে লগইন করবেন না)।
4. ইমেইল/পাসওয়ার্ড দিয়ে লগইন করুন।
5. এক্সপেক্টেড ফ্লো:
   - কোনো `returnTo` না থাকলে → রিডাইরেক্ট ` /post-auth-landing` (৩১০৭ এ)।
   - পোস্ট-অথ ল্যান্ডিং `GET /api/v1/auth/me` কল করবে (৩১০৭ থেকে, রাইটের মাধ্যমে ৩০০০)।
   - রেসপন্সে `routing.default_redirect` = `"/doctor/dashboard"` এবং `panels.doctor` = true।
   - তারপর `router.replace("/doctor/dashboard")` → `http://localhost:3107/doctor/dashboard`।
6. ডাক্তার লেআউট আবার `GET /api/v1/auth/me` করবে; কুকি ৩১০৭ এর জন্য থাকলে ২০০ আসবে এবং ড্যাশবোর্ড রেন্ডার হবে।

যদি কোনো স্টেপে ভিন্ন হয় (যেমন ৪০১, বা রিডাইরেক্ট অন্য জায়গায়), নিচের ট্রাবলশুটিং দেখুন।

---

## ৪. ট্রাবলশুটিং

| লক্ষণ | সম্ভাব্য কারণ | করণীয় |
|--------|----------------|--------|
| লগইনের পর আবার লগইন পেজে চলে আসা | সেশন কুকি অন্য পোর্টে সেট হয়েছে | লগইন শুধু ৩১০৭ এ করুন; ৩১০৭/doctor/login ব্যবহার করলে তা ৩১০৭/login এ নিয়ে যাবে (same-origin)। |
| পোস্ট-অথ ল্যান্ডিং এ “Loading…” এর পর লগইন পেজ | auth/me ৪০১ (কুকি নেই বা এক্সপায়ার্ড) | কুকি ৩১০৭ এ সেট হচ্ছে কিনা DevTools → Application → Cookies দেখুন; লগইন আবার ৩১০৭ এ করুন। |
| পোস্ট-অথ ল্যান্ডিং এ choose-activity বা getting-started | `panels.doctor` false অথবা `default_redirect` ওভাররাইড না হওয়া | Backend এ doctor ওভাররাইড লাইন আছে কিনা চেক করুন; DB এ DoctorVerification VERIFIED চেক করুন। |
| ৩১০৭/doctor/dashboard লোড হলে সাথে সাথে /doctor/login এ চলে যাওয়া | Layout এ auth/me ৪০১ বা `hasDoctorAccess` false | নেটওয়ার্ক ট্যাবে auth/me রেসপন্স দেখুন: panels.doctor ও doctorVerificationStatus; কুকি পাঠানো হচ্ছে কিনা দেখুন। |
| লগইন ৩১০০ এ করেছি, তারপর ৩১০৭ এ গিয়ে ড্যাশবোর্ড খুলছে না | কুকি ৩১০০ এ, ৩১০৭ এ নেই | সবসময় ৩১০৭ এ লগইন করুন; অথবা পোস্ট-অথ ল্যান্ডিং এ ক্রস-পোর্ট রিডাইরেক্ট ইমপ্লিমেন্ট করুন (বিভাগ ২.৩)। |

---

## ৫. সংক্ষিপ্ত চেকলিস্ট

- [ ] Backend এ `if (panels.doctor === true) default_redirect = "/doctor/dashboard";` আছে।
- [ ] `post-auth-landing/page.tsx` এ `PANEL_PATHS` এ `doctor: "/doctor/dashboard"` আছে।
- [ ] `authRedirect.ts` এ doctor এর জন্য same-origin login (buildAuthUrl + getAuthRedirectUrl) আছে।
- [ ] টেস্ট ইউজারের জন্য DB এ ClinicStaffProfile (DOCTOR) + DoctorVerification (VERIFIED)।
- [ ] লগইন সরাসরি `http://localhost:3107/login` থেকে করা।
- [x] ডাক্তার ক্যান্ডিডেটের জন্য default_redirect = `/doctor/verification` (backend এ করা আছে)।
- [x] পোস্ট-অথ ল্যান্ডিং এ path `/doctor/...` এবং পোর্ট ৩১০৭ না হলে ফুল URL এ রিডাইরেক্ট (post-auth-landing এ করা আছে)।

এই গাইড অনুসরণ করলে ডাক্তার লগইন থেকে ড্যাশবোর্ড ফ্লো স্ট্যান্ডার্ড রাখা অবস্থায় শুধুমাত্র ডাক্তার রাউট/লগইন সিস্টেমে পরিবর্তন করে ঠিক করা যায়।
