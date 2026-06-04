# Business Requirements Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Introduction

### 1.1 Purpose
This document defines the business requirements for the 2026 Cat Flu + Rabies Vaccination Campaign system. It establishes functional and non-functional requirements that the system must satisfy.

### 1.2 Business Context
Bangladesh Pet Alliance (BPA) is launching a mass vaccination campaign for cats to combat rabies and cat flu. The campaign requires a digital system to manage registrations, appointments, vaccinations, and certificates at scale.

---

## 2. Business Objectives

### 2.1 Primary Goals
| ID | Objective | Measurable Target |
|----|-----------|-------------------|
| BO-1 | Increase cat vaccination coverage | 10,000+ cats vaccinated in campaign |
| BO-2 | Reduce administrative overhead | 80% reduction vs paper-based system |
| BO-3 | Create verifiable vaccination records | 100% digital certificates |
| BO-4 | Build pet owner database | Convert 30% to BPA app users |
| BO-5 | Enable data-driven public health | Complete demographic analytics |

### 2.2 Success Metrics
- **Registration Rate**: 500+ daily bookings at peak
- **No-show Rate**: <20%
- **Certificate Verification**: <3 second response time
- **Owner Satisfaction**: >4.0/5.0 survey rating

---

## 3. Stakeholder Requirements

### 3.1 Pet Owners (Primary Users)

| ID | Requirement | Priority |
|----|-------------|----------|
| PO-1 | Register with mobile number only (no account required) | P0 |
| PO-2 | Book appointment online with date/time selection | P0 |
| PO-3 | Add pet details during booking | P0 |
| PO-4 | Receive SMS confirmation with QR code | P0 |
| PO-5 | View booking details via link | P0 |
| PO-6 | Cancel/reschedule booking | P1 |
| PO-7 | Receive reminder SMS before appointment | P1 |
| PO-8 | Download vaccination certificate | P0 |
| PO-9 | Link vaccination to existing BPA account | P1 |
| PO-10 | Walk-in registration at venue | P0 |

### 3.2 Campaign Staff (Vaccination Teams)

| ID | Requirement | Priority |
|----|-------------|----------|
| ST-1 | Scan QR code to verify booking | P0 |
| ST-2 | Check-in attendee and mark arrival | P0 |
| ST-3 | Record vaccination with batch/lot info | P0 |
| ST-4 | Handle walk-in registrations | P0 |
| ST-5 | View daily schedule and queue | P1 |
| ST-6 | Search by phone number | P0 |
| ST-7 | Print/share certificate | P1 |
| ST-8 | Mark no-shows | P1 |
| ST-9 | Handle multiple pets per owner | P0 |
| ST-10 | View vaccination history | P2 |

### 3.3 Campaign Administrators

| ID | Requirement | Priority |
|----|-------------|----------|
| AD-1 | Create and configure campaigns | P0 |
| AD-2 | Set locations, dates, and time slots | P0 |
| AD-3 | Define vaccination types and pricing | P0 |
| AD-4 | Set daily/slot quotas | P0 |
| AD-5 | View real-time dashboard | P1 |
| AD-6 | Generate reports | P0 |
| AD-7 | Export data (CSV/Excel) | P1 |
| AD-8 | Send bulk SMS notifications | P2 |
| AD-9 | Manage staff access | P1 |
| AD-10 | Configure SMS templates | P2 |

### 3.4 Public/Verifiers

| ID | Requirement | Priority |
|----|-------------|----------|
| VR-1 | Verify certificate via QR code scan | P0 |
| VR-2 | View basic vaccination details publicly | P0 |
| VR-3 | Report suspicious certificates | P2 |

---

## 4. Functional Requirements

### 4.1 Campaign Management (FR-CM)

| ID | Requirement | Description |
|----|-------------|-------------|
| FR-CM-1 | Create Campaign | Admin can create a new campaign with name, dates, description |
| FR-CM-2 | Campaign Locations | Add multiple vaccination sites per campaign |
| FR-CM-3 | Time Slot Configuration | Define available time slots per location |
| FR-CM-4 | Quota Management | Set maximum bookings per slot |
| FR-CM-5 | Vaccine Configuration | Select vaccine types for campaign |
| FR-CM-6 | Pricing Rules | Set free/paid with amount |
| FR-CM-7 | Campaign Status | Draft, Active, Paused, Completed |
| FR-CM-8 | Campaign Visibility | Public/Private toggle |

### 4.2 Booking System (FR-BK)

| ID | Requirement | Description |
|----|-------------|-------------|
| FR-BK-1 | Phone Registration | Register with phone number + OTP |
| FR-BK-2 | Location Selection | Choose from available campaign locations |
| FR-BK-3 | Date Selection | Show available dates with capacity |
| FR-BK-4 | Slot Selection | Choose time slot with remaining capacity |
| FR-BK-5 | Pet Information | Enter pet name, type, breed, age, gender |
| FR-BK-6 | Multiple Pets | Add multiple pets to single booking |
| FR-BK-7 | Owner Information | Collect name, address (optional) |
| FR-BK-8 | Payment Processing | Handle paid campaigns |
| FR-BK-9 | Booking Confirmation | Generate unique booking reference |
| FR-BK-10 | QR Token | Generate scannable QR for check-in |
| FR-BK-11 | SMS Confirmation | Send booking details via SMS |
| FR-BK-12 | Booking Modification | Allow reschedule within policy |
| FR-BK-13 | Booking Cancellation | Cancel with refund per policy |
| FR-BK-14 | Waitlist | Optional queue when slots full |

### 4.3 Check-in & Vaccination (FR-VAC)

| ID | Requirement | Description |
|----|-------------|-------------|
| FR-VAC-1 | QR Scan Check-in | Staff scans QR to pull booking |
| FR-VAC-2 | Phone Search | Lookup by phone number |
| FR-VAC-3 | Manual Check-in | Mark booking as arrived |
| FR-VAC-4 | Walk-in Registration | On-site registration flow |
| FR-VAC-5 | Queue Management | Assign queue number |
| FR-VAC-6 | Pre-vaccination Check | Confirm pet health status |
| FR-VAC-7 | Vaccine Administration | Record vaccine type, batch, lot |
| FR-VAC-8 | Vet Signature | Capture administering vet info |
| FR-VAC-9 | Post-vaccination Notes | Optional medical notes |
| FR-VAC-10 | Certificate Generation | Auto-generate on completion |
| FR-VAC-11 | SMS Certificate | Send certificate link via SMS |
| FR-VAC-12 | No-show Handling | Mark and optionally reschedule |

### 4.4 Certificate & Verification (FR-CERT)

| ID | Requirement | Description |
|----|-------------|-------------|
| FR-CERT-1 | Unique Certificate Token | 16-character alphanumeric |
| FR-CERT-2 | QR Code Generation | Embeddable QR with verification URL |
| FR-CERT-3 | PDF Generation | Downloadable PDF certificate |
| FR-CERT-4 | Certificate Content | Pet, owner, vaccine, date, vet info |
| FR-CERT-5 | Public Verification | Anonymous verification endpoint |
| FR-CERT-6 | Verification Response | Show limited public info |
| FR-CERT-7 | Certificate Revocation | Admin can invalidate |
| FR-CERT-8 | Certificate Reissue | Generate new if lost |

### 4.5 SMS & Notifications (FR-SMS)

| ID | Requirement | Description |
|----|-------------|-------------|
| FR-SMS-1 | Booking Confirmation | Immediate SMS after booking |
| FR-SMS-2 | Reminder D-1 | SMS 1 day before appointment |
| FR-SMS-3 | Reminder D-0 | SMS on appointment day |
| FR-SMS-4 | Vaccination Complete | SMS with certificate link |
| FR-SMS-5 | Reschedule Notification | SMS on booking change |
| FR-SMS-6 | Cancellation Confirmation | SMS on cancellation |
| FR-SMS-7 | Campaign Announcements | Admin-triggered bulk SMS |
| FR-SMS-8 | Template Management | Configurable message templates |

### 4.6 Reporting (FR-RPT)

| ID | Requirement | Description |
|----|-------------|-------------|
| FR-RPT-1 | Campaign Summary | Total bookings, vaccinations, no-shows |
| FR-RPT-2 | Daily Report | Per-day statistics |
| FR-RPT-3 | Location Report | Per-venue breakdown |
| FR-RPT-4 | Vaccine Usage | Doses administered by type |
| FR-RPT-5 | Demographics | Pet type, age, area distribution |
| FR-RPT-6 | Financial Report | Revenue, refunds, pending |
| FR-RPT-7 | Staff Activity | Actions per staff member |
| FR-RPT-8 | Export | CSV/Excel download |
| FR-RPT-9 | Real-time Dashboard | Live counters |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-P-1 | Page Load Time | <3 seconds |
| NFR-P-2 | API Response Time | <500ms (95th percentile) |
| NFR-P-3 | Concurrent Users | 500+ simultaneous |
| NFR-P-4 | Certificate Generation | <5 seconds |
| NFR-P-5 | QR Scan Response | <2 seconds |

### 5.2 Availability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-A-1 | System Uptime | 99.5% |
| NFR-A-2 | Scheduled Maintenance | Off-peak only |
| NFR-A-3 | Disaster Recovery | 4-hour RTO |

### 5.3 Security

| ID | Requirement | Description |
|----|-------------|-------------|
| NFR-S-1 | OTP Authentication | Phone verification required |
| NFR-S-2 | Staff Authentication | Existing BPA auth |
| NFR-S-3 | API Security | Rate limiting, CORS |
| NFR-S-4 | Data Encryption | HTTPS, encrypted at rest |
| NFR-S-5 | Audit Logging | All vaccination actions logged |

### 5.4 Usability

| ID | Requirement | Description |
|----|-------------|-------------|
| NFR-U-1 | Mobile First | Responsive design |
| NFR-U-2 | Bangla Support | Bengali language option |
| NFR-U-3 | Accessibility | WCAG 2.1 AA compliance |
| NFR-U-4 | Offline Staff Mode | Limited offline capability |

### 5.5 Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-SC-1 | Database Queries | <100ms for booking operations |
| NFR-SC-2 | SMS Queue | 1000+ messages/minute |
| NFR-SC-3 | Concurrent Bookings | 100/minute |

---

## 6. Business Rules

### 6.1 Booking Rules
| Rule | Description |
|------|-------------|
| BR-1 | One phone number can book multiple pets |
| BR-2 | Maximum 5 pets per booking |
| BR-3 | Booking requires minimum 24-hour advance notice |
| BR-4 | Same phone cannot book same slot twice |
| BR-5 | Cancellation allowed up to 4 hours before slot |

### 6.2 Vaccination Rules
| Rule | Description |
|------|-------------|
| BR-6 | Each pet receives one vaccine dose per campaign |
| BR-7 | Walk-ins processed after scheduled bookings |
| BR-8 | Vaccination must be recorded by authorized staff |
| BR-9 | Certificate generated only after vaccination complete |

### 6.3 Payment Rules (if applicable)
| Rule | Description |
|------|-------------|
| BR-10 | Full payment required at booking |
| BR-11 | Refund 100% if cancelled 24+ hours before |
| BR-12 | Refund 50% if cancelled 4-24 hours before |
| BR-13 | No refund within 4 hours |

---

## 7. Data Requirements

### 7.1 Data Collection
| Data Point | Required | Purpose |
|------------|----------|---------|
| Phone Number | Yes | Primary identity, SMS |
| Owner Name | Yes | Certificate |
| Pet Name | Yes | Record |
| Pet Species | Yes | Cat only for this campaign |
| Pet Breed | No | Analytics |
| Pet Age | No | Analytics |
| Pet Gender | No | Analytics |
| Address | No | Demographics |
| NID | No | Future verification |

### 7.2 Data Retention
- Vaccination records: Permanent
- Booking data: 2 years
- SMS logs: 1 year
- Audit logs: 5 years

---

## 8. Integration Requirements

### 8.1 Internal Integrations
| System | Integration Type | Purpose |
|--------|------------------|---------|
| BPA Backend | REST API | All data operations |
| BPA Database | Via Prisma ORM | Data storage |
| BPA Auth | JWT | Staff authentication |
| BPA Notifications | BullMQ | SMS queue |

### 8.2 External Integrations
| System | Integration Type | Purpose |
|--------|------------------|---------|
| SMS Gateway | API | Message delivery |
| Payment Gateway | API | Online payments |
| PDF Generator | Library | Certificates |

---

## 9. Acceptance Criteria

### 9.1 Minimum Viable Product (MVP)
- [ ] Pet owner can book via phone number
- [ ] System generates QR token
- [ ] Staff can scan and verify booking
- [ ] Staff can record vaccination
- [ ] Certificate generated with QR
- [ ] Certificate verifiable publicly
- [ ] Basic reports available

### 9.2 Full Release Criteria
- [ ] All P0 requirements implemented
- [ ] 80% of P1 requirements implemented
- [ ] Load tested for 500 concurrent users
- [ ] Security audit passed
- [ ] User acceptance testing completed

---

## 10. Glossary

| Term | Definition |
|------|------------|
| BPA | Bangladesh Pet Alliance |
| Campaign | A vaccination event with defined dates and locations |
| Booking | A scheduled appointment for vaccination |
| Token | QR code reference for booking verification |
| Check-in | Process of verifying and admitting a booking |
| Walk-in | Unscheduled vaccination at venue |
| Certificate | Official proof of vaccination |
