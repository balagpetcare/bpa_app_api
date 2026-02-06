# 🐾 Bangladesh Pet Association (BPA) - Project Documentation

## ১. ভিশন ও উদ্দেশ্য (Mission & Vision)

বাংলাদেশে পোষা প্রাণীর সেবা এবং চিকিৎসাকে একটি ডিজিটাল ও সুশৃঙ্খল ছাতার নিচে নিয়ে আসা। পেট ওনার, ডাক্তার এবং ভেন্ডরদের মধ্যে একটি স্মার্ট ইকোসিস্টেম তৈরি করা।

---

## ২. কোর মডিউল: যা এই সিস্টেমে থাকবে

### ক. স্মার্ট ক্লিনিক ও ডাক্তার ম্যানেজমেন্ট

এটি কেবল একটি অ্যাপ নয়, এটি একটি ভার্চুয়াল হসপিটাল ম্যানেজমেন্ট সিস্টেম।

* **ডিজিটাল প্রেসক্রিপশন:** ডাক্তার অ্যাপ থেকে ওষুধ এবং টেস্ট সাজেস্ট করবেন।
* **ডিজিটাল হেলথ রেকর্ড:** প্রতিটি পেটের নিজস্ব প্রোফাইল থাকবে যেখানে তার সব রিপোর্ট এবং ভ্যাকসিনেশন হিস্ট্রি থাকবে।
* **হোম ভিজিট সিস্টেম:** লোকেশন বেজড সার্ভিস যার মাধ্যমে মালিক তার বাসায় ডাক্তার ডাকতে পারবেন।

### খ. মাল্টি-ভেন্ডর ই-কমার্স ও ইনভেন্টরি

* **ভেন্ডর ড্যাশবোর্ড:** প্রতিটি পেট শপ বা ফার্মেসি তাদের নিজস্ব প্যানেল পাবে।
* **POS (Point of Sale):** ছোট দোকানদাররা কোনো রেজিস্টার খাতা ছাড়াই আমাদের সিস্টেম ব্যবহার করে তাদের ইনভেন্টরি, স্টক এবং সেলস ট্র্যাক করতে পারবে।
* **স্মার্ট স্টক ম্যানেজমেন্ট:** স্টক ফুরিয়ে যাওয়ার আগে অটোমেটেড অ্যালার্ট।

### গ. সোশ্যাল ও কমিউনিটি এনগেজমেন্ট

* **BPA সোশ্যাল:** পেট ওনাররা তাদের পোষা প্রাণীর ছবি ও অভিজ্ঞতা শেয়ার করবেন।
* **অ্যাডাপশন পোর্টাল:** পরিচয় যাচাইকৃত মালিকদের মাধ্যমে প্রাণীদের দত্তক নেওয়ার সুব্যবস্থা।

---

## ৩. MVP ভার্সন (প্রাথমিক যাত্রা): অতি প্রয়োজনীয় ফিচারসমূহ

একটি বড় সিস্টেম শুরু করার জন্য আমাদের প্রথম ধাপে নিচের ৪টি বিষয়ের ওপর ফোকাস করতে হবে:

| ফিচার | বিস্তারিত বর্ণনা |
| --- | --- |
| **ইউজার প্রোফাইল** | মালিক এবং তার পোষা প্রাণীর ডিটেইলস (নাম, জাত, বয়স, ছবি)। |
| **ডক্টর অ্যাপয়েন্টমেন্ট** | অনলাইনে বুকিং এবং ক্লিনিকে বা বাসায় সার্ভিস নেওয়ার ব্যবস্থা। |
| **ডিজিটাল মেডিকেল হিস্ট্রি** | ভ্যাকসিনেশনের রিমাইন্ডার এবং ল্যাব রিপোর্ট সংরক্ষণের সুবিধা। |
| **বেসিক ই-কমার্স** | খাবার এবং প্রয়োজনীয় আনুষঙ্গিক অর্ডারের সুবিধা। |

---

## ৪. ইউজার এনগেজমেন্ট ও রিওয়ার্ড সিস্টেম (গ্যামিফিকেশন)

সিস্টেমটি নিয়মিত ব্যবহারের জন্য গ্রাহকদের উৎসাহিত করতে আমরা নিচের পদ্ধতিগুলো রাখছি:

* **BPA ওনার্স কার্ড:** এটি একটি প্রিমিয়াম সাবস্ক্রিপশন কার্ড। এটি থাকলে প্রতিটি সার্ভিসে বা কেনাকাটায় বিশেষ ডিসকাউন্ট পাওয়া যাবে।
* **লিডারবোর্ড ও পয়েন্ট:** অ্যাপে সক্রিয় থাকা বা কেনাকাটা করলে 'BPA Coins' জমা হবে। এই কয়েন দিয়ে পরবর্তীতে ফ্রি চেকআপ বা গিফট পাওয়া যাবে।
* **প্রতিযোগিতা:** "সেরা পেট ওনার" বা "সেরা সুস্থ পেট" ক্যাটাগরিতে পয়েন্টের ভিত্তিতে বিজয়ীদের পুরস্কার দেওয়া হবে।

---

## ৫. টেকনিক্যাল আর্কিটেকচার (Tech Stack)

প্রজেক্টটি শক্তিশালী ও স্কেলেবল করার জন্য আমরা আধুনিক প্রযুক্তি ব্যবহার করছি:

* **Frontend:**
  - Next.js (Web Dashboards - Owner, Admin, Clinic, Shop)
  - Flutter (Mobile App - Android & iOS)
* **Backend:** Node.js + Express (High performance API)
* **Database:** PostgreSQL with Prisma (নিরাপদ ও স্ট্রাকচার্ড ডাটা স্টোরেজ)
* **Storage:** MinIO (Media & Document Storage)
* **Containerization:** Docker & Docker Compose (দ্রুত ডিপ্লয়মেন্টের জন্য)
* **State Management:** Riverpod (Flutter App)

### Fixed Ports (DO NOT CHANGE)

* **API:** Port 3000
* **Next.js Apps:**
  - Mother: 3100
  - Shop: 3101
  - Clinic: 3102
  - Admin: 3103
  - Owner: 3104

---

## ৬. ভবিষ্যতে আমরা যা যুক্ত করব (Roadmap)

* **AI Diagnostics:** ছবি দেখে প্রাথমিক চর্মরোগ বা সমস্যা শনাক্ত করার এআই টুল।
* **ব্লাড ব্যাংক:** পোষা প্রাণীদের জন্য একটি সেন্ট্রাল ব্লাড ডোনার ডাটাবেস।
* **গ্লোবাল এক্সপ্যানশন:** বাংলাদেশের পর এই মডেলকে বাইরে নিয়ে যাওয়া (বিশেষ করে ইউরোপীয় মানদণ্ড অনুসরণ করে)।
* **Customer Mobile App:** Pet Parents-এর জন্য dedicated mobile application
* **Membership & Loyalty Program:** Advanced rewards and discount system
* **Central Delivery Hub:** Integrated delivery management system
* **Donation Platform:** Stray animal welfare and donation system
* **Advanced Analytics:** Business intelligence and reporting dashboard

---

## ৭. বর্তমান উন্নয়ন অবস্থা (Current Development Status)

### ✅ সম্পন্ন হয়েছে (Completed)

* Authentication & Authorization System
* Organization & Branch Management
* Staff Management & Role-based Access Control
* KYC Verification System
* Owner Dashboard
* Admin Dashboard
* Branch Management UI
* Staff Invitation System

### 🚧 চলমান উন্নয়ন (In Progress)

* Staff login routes fix
* Role-based dashboard visibility
* Email & notification template integration
* Verification review UI enhancements

### 📋 পরিকল্পিত (Planned)

* Product & Service Management
* Inventory & POS System
* Order Management
* Delivery System
* Reports & Analytics
* Multi-language Support (English + Bengali)

---

## ৮. BPA Standards & Principles

* **UI Consistency:** WowDash Admin Template অনুসরণ
* **Code Quality:** Update-only patches, never delete working code
* **Versioning:** Semantic versioning (MAJOR.MINOR.PATCH)
* **Backward Compatibility:** Existing routes must remain compatible
* **Security:** Cookie-based authentication, RBAC middleware

---

## ৯. MVP Completion Definition

MVP তখনই complete হবে, যখন:

✔️ Owner একটি Clinic/Shop চালাতে পারবে
✔️ Staff POS দিয়ে বিক্রি করতে পারবে
✔️ Stock ঠিকমতো কমবে
✔️ Report দেখা যাবে
✔️ System crash না করে চলবে

---

## ১০. Target Users

### Internal Users (Platform Users)

* **Owner:** পুরো Organization ম্যানেজ করেন
* **Branch Manager:** একটি Branch পরিচালনা করেন
* **Vet:** Clinical Service প্রদান করেন
* **Staff/Seller:** Sales & POS পরিচালনা করেন
* **Delivery Staff:** Order Delivery করেন
* **Admin (BPA):** Platform Control করেন

### External Users (Future Phase)

* **Pet Parents:** Customer mobile app ব্যবহার করবেন
* **Pet Owners:** Pet profiles এবং appointments ম্যানেজ করবেন

---

## 📚 Related Documents

* [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) - Technical context and setup guide
* [BPA_STANDARD.md](./BPA_STANDARD.md) - Technical standards and mandatory rules (if exists)

---

*Last Updated: January 2026*
*Version: 1.0.0*
