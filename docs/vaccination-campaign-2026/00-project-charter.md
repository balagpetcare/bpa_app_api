# Project Charter: 2026 Cat Flu + Rabies Vaccination Campaign

## Document Control
| Version | Date | Author | Description |
|---------|------|--------|-------------|
| 1.0 | 2026-06-02 | Planning Team | Initial Draft |

---

## 1. Executive Summary

The **2026 Cat Flu + Rabies Vaccination Campaign** is a public health initiative to provide subsidized or free vaccinations for cats in Bangladesh. This system will operate as a **standalone frontend** that integrates with the **existing BPA (Bangladesh Pet Alliance) backend infrastructure** and **PostgreSQL database**.

### Key Principles
- **No separate backend** - Reuse existing BPA backend API
- **No separate database** - Extend existing PostgreSQL schema
- **Mobile number as primary identity** - Phone-first registration for walk-in campaigns
- **Future BPA app linking** - Designed for seamless migration to BPA user accounts

---

## 2. Project Objectives

### Primary Objectives
1. Enable mass vaccination registration via mobile number
2. Provide online booking and walk-in support
3. Generate verifiable QR-coded vaccination certificates
4. Track vaccination records with audit trail
5. Support SMS notifications for reminders and confirmations
6. Enable staff to verify and record vaccinations on-site

### Secondary Objectives
1. Collect demographic data for future public health planning
2. Build a database of cat owners for BPA app conversion
3. Test scalable vaccination workflow for future campaigns
4. Generate reports for government and donor stakeholders

---

## 3. Scope Definition

### In Scope
| Module | Description |
|--------|-------------|
| Campaign Management | Create/manage vaccination campaigns with schedules, locations, quotas |
| Campaign Booking | Online appointment booking with time slots |
| Booking Pets | Pet registration during booking (temporary records) |
| Payment Integration | Handle booking fees, cancellations, refunds via existing payment infra |
| QR Token System | Generate unique QR tokens for booking verification |
| SMS Notifications | Booking confirmation, reminders, campaign updates |
| Vaccination Verification | Staff portal to verify QR tokens and check-in attendees |
| Vaccination Record | Create permanent vaccination records linked to pets |
| Certificate Generation | PDF certificates with QR codes for verification |
| Reporting | Campaign analytics, vaccination counts, demographic reports |
| Future BPA App Linking | Phone-based account linking for BPA app users |

### Out of Scope
- New backend infrastructure
- Separate database instance
- Native mobile app for this campaign (web-only)
- Integration with government vaccination registries (Phase 2)
- Multi-country support

---

## 4. Stakeholders

| Stakeholder | Role | Interest |
|-------------|------|----------|
| BPA Foundation | Sponsor | Campaign success, data collection |
| Veterinary Team | Users | Efficient vaccination workflow |
| Pet Owners | End Users | Easy booking, proof of vaccination |
| Government (DLS) | Regulator | Public health data, compliance |
| IT Team | Implementers | System stability, reusability |
| Donors/Partners | Funders | Impact metrics, reporting |

---

## 5. Success Criteria

| Metric | Target |
|--------|--------|
| System Uptime | 99.5% during campaign period |
| Booking Completion Rate | >80% of started bookings complete |
| Check-in Time | <2 minutes per pet |
| Certificate Generation | <5 seconds |
| SMS Delivery Rate | >95% |
| Data Accuracy | 100% vaccination records linked to owners |

---

## 6. Architecture Constraints

### Must Use
- Existing BPA backend API (`D:\BPA_Data\backend-api`)
- Existing PostgreSQL database
- Existing notification infrastructure (BullMQ + nodemailer)
- Existing authentication patterns

### Campaign Frontend Stack
- Standalone Next.js application (`D:\BPA_Data\vaccination_2026`)
- React 19 + Tailwind CSS
- Connects to BPA backend via REST API
- No local database or backend

---

## 7. Timeline Overview

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1: Planning | 1 week | This documentation |
| Phase 2: Backend Extensions | 2 weeks | New tables, API endpoints |
| Phase 3: Frontend Development | 3 weeks | Booking portal, staff portal |
| Phase 4: Integration Testing | 1 week | End-to-end testing |
| Phase 5: Pilot Campaign | 1 week | Limited rollout |
| Phase 6: Full Launch | Ongoing | Production campaign |

---

## 8. Existing Infrastructure Analysis

### Backend (BPA API)
- **Stack**: Node.js, Express, TypeScript, Prisma ORM
- **Database**: PostgreSQL with 200+ tables
- **Auth**: JWT-based with phone/email verification
- **Payment**: Order/Payment models with split-tender support
- **Notifications**: BullMQ queues for email/SMS

### Relevant Existing Models
| Model | Reuse Potential | Notes |
|-------|-----------------|-------|
| `User` | Full | Base user model with phone auth |
| `UserAuth` | Full | Phone/email authentication |
| `Pet` | Full | Pet records with owner linkage |
| `VaccineType` | Full | Existing vaccine type definitions |
| `Vaccination` | Full | Vaccination record with certificate token |
| `VaccinationReminder` | Full | Reminder scheduling |
| `Order` | Partial | Payment processing |
| `OrderPayment` | Partial | Split-tender payments |
| `Notification` | Full | In-app + SMS delivery |
| `NotificationDelivery` | Full | SMS/Email delivery tracking |

### Missing Infrastructure for Campaign
| Component | Status | Action Required |
|-----------|--------|-----------------|
| Campaign Model | Missing | Create new table |
| CampaignSlot Model | Missing | Create new table |
| CampaignBooking Model | Missing | Create new table |
| CampaignPet Model | Missing | Create new table (temporary pets) |
| BookingPayment | Partial | Extend existing Order model |
| SMS Gateway | Partial | Configure for bulk SMS |
| QR Token System | Partial | Extend existing certificate token |
| Public Verification API | Missing | Create new endpoint |

---

## 9. Risk Summary

| Risk | Impact | Mitigation |
|------|--------|------------|
| Database contention | High | Separate campaign-specific indexes |
| SMS gateway limits | Medium | Pre-arrange bulk SMS quota |
| Walk-in overload | High | Implement queue management |
| Data migration complexity | Medium | Design for future BPA linking |
| Staff training | Medium | Simplified staff portal UX |

---

## 10. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Sponsor | | | |
| Technical Lead | | | |
| Product Owner | | | |

---

## Appendix A: Reference Documents

- `D:\BPA_Data\backend-api\prisma\schema.prisma` - Database schema
- `D:\BPA_Data\backend-api\src\api\v1\modules\clinic\vaccination.service.ts` - Vaccination service
- `D:\BPA_Data\backend-api\src\api\v1\services\notification.service.ts` - Notification service
- `D:\BPA_Data\bpa_web\package.json` - Web panel reference
- `D:\BPA_Data\bpa_app\pubspec.yaml` - Mobile app reference
