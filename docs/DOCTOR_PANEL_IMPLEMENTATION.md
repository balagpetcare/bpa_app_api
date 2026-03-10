# Doctor Panel Implementation (Minimum Version)

## Overview

ডাক্তারদের জন্য আলাদা ড্যাশবোর্ড পোর্ট ৩১০৭ এ চালু। ডাক্তাররা একাধিক ক্লিনিকে অ্যাসাইন থাকলে সব ক্লিনিকের অ্যাপয়েন্টমেন্ট ও ভিজিট এক জায়গায় দেখতে পারবেন।

## Backend Changes

### 1. Doctor API (`/api/v1/doctor/*`)

- **GET /api/v1/doctor/me** — ডাক্তারের প্রোফাইল (কোন কোন ব্রাঞ্চে অ্যাসাইন, ভিজিটিং ফি ইত্যাদি)
- **GET /api/v1/doctor/appointments** — অ্যাপয়েন্টমেন্ট লিস্ট (date, branchId, status ফিল্টার)
- **GET /api/v1/doctor/visits** — ভিজিট লিস্ট (date, branchId ফিল্টার)

### 2. Auth (`GET /api/v1/auth/me`)

- `panels.doctor: true` — যখন ইউজারের `ClinicStaffProfile` আছে যেখানে `staffType: "DOCTOR"`

### 3. Files Added/Modified

| File | Change |
|------|--------|
| `src/api/v1/modules/doctor/doctor.service.ts` | NEW |
| `src/api/v1/modules/doctor/doctor.controller.ts` | NEW |
| `src/api/v1/modules/doctor/doctor.routes.ts` | NEW |
| `src/api/v1/routes.ts` | ADD doctor routes |
| `src/api/v1/modules/auth/auth.controller.ts` | ADD panels.doctor |

## Frontend Changes

### 1. Doctor App (port 3107)

- **Layout** — Auth guard (panels.doctor চেক)
- **Login** — Central auth redirect
- **Dashboard** — আজকের অ্যাপয়েন্টমেন্ট কাউন্ট, ক্লিনিক লিস্ট
- **Appointments** — তারিখ ও ব্রাঞ্চ ফিল্টার সহ অ্যাপয়েন্টমেন্ট টেবিল
- **Patients** — ভিজিট হিস্ট্রি (তারিখ ও ব্রাঞ্চ ফিল্টার)

### 2. Menu & Routing

- `permissionMenu.ts` — doctor AppKey ও REGISTRY
- `panelMenus.ts` — doctor basePath
- `authRedirect.ts` — doctor PANEL_CONFIG, ALLOWED_PORTS 3107

### 3. API Functions (`lib/api.ts`)

- `doctorGetMe()`
- `doctorListAppointments(params)`
- `doctorListVisits(params)`

## How to Run

```bash
# Doctor panel only
npm run dev:doctor

# All panels (includes doctor)
npm run dev:all
```

Doctor panel: http://localhost:3107/doctor

## Access Requirements

ডাক্তার হিসেবে অ্যাক্সেস পেতে ইউজারকে:

1. কোনো ক্লিনিক ব্রাঞ্চে `BranchMember` হতে হবে
2. সেই ব্রাঞ্চে `ClinicStaffProfile` থাকতে হবে যেখানে `staffType: "DOCTOR"`

ওনার/ম্যানেজার স্টাফ ইনভাইট করে ডাক্তার হিসেবে অ্যাসাইন করলে সেই ইউজার doctor panel অ্যাক্সেস পাবে।
