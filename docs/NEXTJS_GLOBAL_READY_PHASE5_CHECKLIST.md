# Next.js (bpa_web) Global-Ready Phase 5 – 100% Checklist

**উদ্দেশ্য:** পরিকল্পনা অনুযায়ী bpa_web এ Phase 5 (Frontend country + policy UI) সম্পূর্ণ।

**রেফারেন্স:** [GLOBAL_READY_PHASE5_APPLY.md](./GLOBAL_READY_PHASE5_APPLY.md), [GLOBAL_READY_MASTER.md](./GLOBAL_READY_MASTER.md)

---

## Phase 5 টাচ পয়েন্ট – স্ট্যাটাস

| টাচ পয়েন্ট | লোকেশন | স্ট্যাটাস |
|-------------|---------|----------|
| **X-Country-Code সব API কলে** | `lib/api.ts` | ✅ Already: getApiHeaders() → X-Country-Code on apiGet/apiPost/apiPatch/apiPut/apiDelete |
| **apiFetch এ X-Country-Code** | `src/lib/apiFetch.js` | ✅ Added: import getCountryCode; headers include "X-Country-Code": getCountryCode() (server: BD) |
| **Country context** | `lib/countryContext.ts` | ✅ getCountryCode (subdomain → localStorage → default BD), setCountryCode, getApiHeaders |
| **Country picker UI** | `src/components/CountrySwitcher.jsx` | ✅ Dropdown BD/IN/US/AE; setCountryCode + router.refresh |
| **CountrySwitcher in layout** | `src/masterLayout/MasterLayout.jsx` | ✅ Navbar: CountrySwitcher next to ThemeToggleButton |
| **Policy features hook** | `lib/usePolicyFeatures.ts` | ✅ donationEnabled, adsEnabled, productsEnabled from GET /api/v1/meta/features |
| **Policy-based menu (Donation/Ads)** | `src/lib/permissionMenu.ts` + MasterLayout | ✅ admin.fundraising has policyFeature "DONATION"; menuRestPolicyFiltered hides item when !donationEnabled/!adsEnabled |
| **Admin Fundraising nav item** | `src/lib/permissionMenu.ts` | ✅ admin.section.ordersFinance → admin.fundraising (href /admin/fundraising) |
| **Admin Fundraising page** | `app/admin/fundraising/page.jsx` | ✅ Hold list (GET .../admin/donations/hold), Approve/Reject (PATCH .../status), usePolicyFeatures message when disabled |

---

## চেকপয়েন্ট

1. **Country header:** যেকোনো পেজ থেকে API কল (lib/api বা apiFetch) করলে request এ `X-Country-Code` থাকে (ক্লায়েন্টে localStorage/subdomain, সার্ভারে BD)।
2. **Country switcher:** ন্যাভবারে দেশ সিলেক্ট করলে localStorage আপডেট হয় ও পেজ রিফ্রেশ; পরবর্তী API কলগুলো নতুন দেশ দিয়ে যায়।
3. **Policy-based nav:** Admin সাইডবারে Fundraising লিংক শুধু তখনই দেখা যাবে যখন বর্তমান দেশের policy তে DONATION enabled; অন্যথায় লুকানো।
4. **Admin Fundraising পেজ:** Hold/KYC ডোনেশন লিস্ট, স্ট্যাটাস ফিল্টার, Approve/Reject বাটন ও নোট; দেশে DONATION বন্ধ থাকলে মেসেজ দেখাবে।

---

## সংক্ষেপ

- **Phase 5 (bpa_web):** X-Country-Code (lib/api + apiFetch), Country picker (CountrySwitcher), Policy-based menu (usePolicyFeatures + menuRestPolicyFiltered), Admin Fundraising পেজ – সব টাচ পয়েন্ট ইমপ্লিমেন্ট ও চেকলিস্টে ভেরিফাই করা হয়েছে।
- **Next.js 100%:** পরিকল্পনা অনুযায়ী Global-Ready Phase 5 সম্পন্ন।
