## Branch Manager – Branch Type vs Module Matrix (MVP)

এই টেবিলটা Branch Manager Dashboard এর জন্য কোন branch type এ কোন module গুলো primary ভাবে enable থাকবে (feature toggle `Branch.featuresJson` এর মাধ্যমে), সেটা summarize করে। Owner/Admin চাইলে per-branch basis এ featuresJson কাস্টমাইজ করতে পারবে, কিন্তু default behaviour এই matrix ফলো করবে।

### Legend

- ✅ = Default enabled for this branch type
- (opt) = Optional / often enabled, but not mandatory
- — = সাধারণত enable করা হবে না (owner চাইলে override করতে পারবে)

### Matrix

| BranchTypeCode           | POS (services / products) | Inventory & Stock | Orders (shop/delivery) | Clinic Services & Appointments | Pharmacy / Medicine | Grooming Services | Delivery Jobs / Riders | Returns & Transfers | Online Store (Hub) |
|--------------------------|---------------------------|-------------------|------------------------|---------------------------------|---------------------|-------------------|------------------------|---------------------|--------------------|
| `CLINIC`                 | ✅ (service billing)      | (opt)             | (opt)                 | ✅                               | (opt)               | (opt)             | —                      | (opt)               | —                  |
| `PET_SHOP`               | ✅ (product POS)          | ✅                 | ✅                      | —                               | (opt)               | —                 | (opt)                  | ✅                   | (opt)              |
| `PHARMACY_DIAGNOSTICS`  | ✅ (medicine POS)         | ✅ (batch/expiry) | ✅                      | (opt)                           | ✅                   | —                 | (opt)                  | ✅                   | —                  |
| `GROOMING_SPA`           | ✅ (service POS)          | (opt)             | (opt)                 | —                               | —                   | ✅                 | —                      | (opt)               | —                  |
| `DELIVERY_HUB`           | —                         | (opt)             | ✅                      | —                               | —                   | —                 | ✅                      | ✅                   | ✅                  |
| `WAREHOUSE_DC`           | —                         | ✅                 | —                      | —                               | —                   | —                 | (opt)                  | ✅                   | (opt)              |
| `BOARDING_DAYCARE`       | ✅ (service POS)          | (opt)             | (opt)                 | (opt)                           | —                   | (opt)             | —                      | (opt)               | —                  |
| `FOSTER_SHELTER`         | (opt)                     | (opt)             | —                      | (opt)                           | —                   | —                 | —                      | —                   | —                  |
| `TRAINING_BEHAVIOR`      | ✅ (service POS)          | (opt)             | (opt)                 | —                               | —                   | (opt)             | —                      | (opt)               | —                  |

### Implementation Notes

- Branch level feature toggle থাকবে `Branch.featuresJson` এর মধ্যে, যেমন:

```json
{
  "pos": true,
  "inventory": true,
  "orders": true,
  "appointments": false,
  "clinicServices": true,
  "pharmacy": false,
  "grooming": false,
  "delivery": false,
  "onlineStore": false,
  "returns": true,
  "transfers": true
}
```

- Branch Manager Dashboard (web, `/admin/branches/[id]`) এই featuresJson দেখে:
  - কোন quick-action button (POS, Appointment, Service, Delivery Job ইত্যাদি) দেখাবে
  - কোন navigation section গুলো highlight করবে (Operations: POS / Services / Delivery vs শুধু Inventory/Reports)
- Owner/Admin panel (`/admin/branches/[id]`) থেকে featuresJson inline form দিয়েই already editable; উক্ত matrix default হিসেবে ধরে নতুন branch তৈরি বা type change সময় sensible defaults apply করা হবে।

