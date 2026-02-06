## লক্ষ্য
- /owner/organizations/:id/edit পেজটা এমনভাবে রিফ্যাক্টর করা যাতে UI/ফিল্ড/স্টেপ/ভ্যালিডেশন একদম /owner/organizations/new (Registration) ফর্মের মতো হয়, শুধু পার্থক্য থাকবে: ডেটা লোড হবে বিদ্যমান Organization থেকে এবং সেভ হবে update endpoints দিয়ে।<mccoremem id="03fi8pxuwjld3f8f8kf710fup" />

## কী আছে এখন (রিসার্চ সারাংশ)
- Registration wizard আছে: [new/page.jsx](file:///d:/BPA_Data/bpa_web/app/owner/organizations/new/page.jsx)
- Edit wizard আছে কিন্তু UX/স্টেপ ন্যাভিগেশন/লোকেশন কম্পোনেন্ট কিছুটা আলাদা: [edit/page.jsx](file:///d:/BPA_Data/bpa_web/app/owner/organizations/%5Bid%5D/edit/page.jsx)
- Backend update/save/submit endpoints একই ডোমেইনে আছে এবং edit পেজে ইতিমধ্যেই ব্যবহার হচ্ছে (PUT org, legal draft, directors, doc upload, submit)।

## ইমপ্লিমেন্টেশন (কোড চেঞ্জ)
### 1) Shared Wizard Component বানানো (ডুপ্লিকেশন কমাতে)
- নতুন shared component যোগ করবো: `app/owner/organizations/_components/OrganizationWizardForm.jsx`
- Props ধারণা:
  - `mode: "create" | "edit"`
  - `orgId` (edit-এ বাধ্যতামূলক)
  - `initialData` (edit-এ GET করে hydrate করা অবস্থা)
  - `onEnsureOrg` / `onSaveBusiness` / `onSaveDraft` / `onUploadDoc` / `onSubmit`
- এই কম্পোনেন্টে থাকবে Registration wizard-এর:
  - 4-step UI (Business → Legal → Documents → Review)
  - একই ফিল্ড সেট (basic/location/typeSpecific/legal/directors/docs)
  - একই validation & error presentation
  - একই bottom navigation (Back + Save Draft + Next/Submit)

### 2) Create Page-কে Shared Component-এ মাইগ্রেট
- [new/page.jsx](file:///d:/BPA_Data/bpa_web/app/owner/organizations/new/page.jsx) থেকে UI-rendering অংশগুলো shared কম্পোনেন্টে সরিয়ে নিবো
- create-specific লজিক (ensureOrgCreated, postLocationManual, submit শেষে list page-এ redirect) পেজে থাকবে এবং shared কম্পোনেন্টে callback হিসেবে যাবে

### 3) Edit Page-কে Registration-এর মতো করা
- [edit/page.jsx](file:///d:/BPA_Data/bpa_web/app/owner/organizations/%5Bid%5D/edit/page.jsx) আপডেট করে:
  - step URL query (`?step=`) নির্ভরতা বাদ দিয়ে Registration-এর মতো internal `step` state ব্যবহার
  - header/buttons Registration-এর মতো করা (top আলাদা Save Business/Save Legal Draft বাটন বাদ দিয়ে bottom nav-এ unified Save Draft)
  - Location UI Registration-এর মতো করা: `LocationPicker` (same component) ব্যবহার
  - `canNext` gating Registration-এর মতো করা (location-এর ক্ষেত্রে fullPathText/text থাকলেই pass)
  - org details GET করে `initialData` hydrate করে shared component-এ পাস
  - Save Draft ক্লিক করলে edit mode-এ:
    - `PUT /api/v1/owner/organizations/:id` (business + addressJson)
    - `POST /legal-profile/save-draft` + `POST /save-directors`
  - Documents step-এ:
    - existing TRADE_LICENSE থাকলে “Already uploaded” দেখানো
    - নতুন file দিলে `media/upload` + `add-document` দিয়ে replace/append
  - Submit ক্লিক করলে: save business + save draft + submit (বর্তমান edit-এর মতই, শুধু UX Registration-এর মতো)

### 4) Status/Lock Handling (সেফটি)
- org status যদি `PENDING_REVIEW`/`APPROVED` হয়, backend draft/verification behavior থাকতে পারে—UI-তে status badge দেখাবো এবং save error হলে পরিষ্কার মেসেজ দেখাবো (বিনা সিক্রেট লগিং)।

## ফাইল/রুট তালিকা
- Update: [new/page.jsx](file:///d:/BPA_Data/bpa_web/app/owner/organizations/new/page.jsx)
- Update: [edit/page.jsx](file:///d:/BPA_Data/bpa_web/app/owner/organizations/%5Bid%5D/edit/page.jsx)
- Add: `app/owner/organizations/_components/OrganizationWizardForm.jsx`
- Reuse: [LocationPicker.jsx](file:///d:/BPA_Data/bpa_web/components/LocationPicker.jsx)

## ভেরিফিকেশন
- লোকালি `http://localhost:3104/owner/organizations/1/edit` খুলে চেক:
  - সব ফিল্ড prefill হচ্ছে কিনা
  - Save Draft দিলে backend success এবং reload/hydrate ঠিক আছে কিনা
  - TRADE_LICENSE replace/upload কাজ করছে কিনা
  - Submit দিলে redirect এবং status pending review হচ্ছে কিনা
- Create flow-এও regression টেস্ট: `/owner/organizations/new` আগের মতো কাজ করছে কিনা

## নন-গোল
- backend স্কিমা/এন্ডপয়েন্ট পরিবর্তন করবো না
- বিদ্যমান পেজ/ফাইল ডিলিট করবো না (শুধু merge/refactor)।<mccoremem id="03fi8pxuwjld3f8f8kf710fup" />