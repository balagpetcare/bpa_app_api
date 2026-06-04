# User Flows Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

This document details the step-by-step user journeys for all actors in the vaccination campaign system.

---

## 2. Pet Owner Flows

### 2.1 Online Booking Flow (Primary)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ONLINE BOOKING FLOW                          │
└─────────────────────────────────────────────────────────────────────┘

[Landing Page]
     │
     ▼
[Select Campaign] ─── View available campaigns
     │
     ▼
[Enter Phone Number] ─── 11-digit BD mobile (01XXXXXXXXX)
     │
     ▼
[Receive OTP] ─── 6-digit code via SMS
     │
     ▼
[Verify OTP] ─── 3 attempts allowed
     │                    │
     │ (Valid)            │ (Invalid)
     ▼                    ▼
[Select Location] ◄─── [Retry/Resend]
     │
     ▼
[Select Date] ─── Show available dates with capacity indicators
     │
     │ (No dates)
     ├───────────► [Show "No slots available" + Waitlist option]
     │
     ▼
[Select Time Slot] ─── Morning/Afternoon slots with remaining count
     │
     │ (No slots)
     ├───────────► [Show "Slot full" + Alternative suggestions]
     │
     ▼
[Add Pet Details]
     │
     ├─── Pet Name (Required)
     ├─── Breed (Optional - dropdown with "Mixed/Unknown")
     ├─── Age (Optional - Years/Months)
     ├─── Gender (Optional - Male/Female/Unknown)
     │
     ▼
[Add Another Pet?]
     │
     │ (Yes)          │ (No)
     ▼                ▼
[Add Pet Details]  [Owner Details]
     │                │
     │                ├─── Name (Required)
     └────────────────┤─── Address (Optional)
                      │
                      ▼
                 [Payment Required?]
                      │
         (Yes)        │        (No/Free)
           ▼          │          ▼
     [Payment Page]   │   [Confirm Booking]
           │          │          │
           ▼          │          │
     [Process Payment]│          │
           │          │          │
    ┌──────┴──────┐   │          │
    │             │   │          │
(Success)     (Failed)│          │
    │             │   │          │
    ▼             ▼   │          │
[Booking         [Retry]         │
 Created]                        │
    │                            │
    └────────────────────────────┘
                 │
                 ▼
         [Confirmation Page]
                 │
         ├─── Booking Reference #
         ├─── QR Code Display
         ├─── Appointment Details
         ├─── Download QR Button
         │
         ▼
         [SMS Sent]
                 │
         ├─── Booking confirmation
         ├─── QR code link
         └─── Appointment details
```

### 2.2 View/Manage Booking Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      VIEW/MANAGE BOOKING FLOW                       │
└─────────────────────────────────────────────────────────────────────┘

[Landing Page]
     │
     ▼
[Check My Booking]
     │
     ▼
[Enter Phone Number]
     │
     ▼
[OTP Verification]
     │
     ▼
[My Bookings List]
     │
     ├─── Upcoming bookings
     ├─── Past bookings
     └─── Cancelled bookings
     │
     ▼
[Select Booking]
     │
     ▼
[Booking Details]
     │
     ├─── [View QR Code]
     ├─── [Reschedule] ─────► Select new date/time ─► Confirm ─► SMS
     ├─── [Cancel] ─────────► Confirm cancellation ─► SMS + Refund
     └─── [Add Pet] ────────► Add more pets to booking
```

### 2.3 Walk-in Registration Flow (At Venue)

```
┌─────────────────────────────────────────────────────────────────────┐
│                       WALK-IN REGISTRATION FLOW                      │
└─────────────────────────────────────────────────────────────────────┘

[Arrive at Venue]
     │
     ▼
[Registration Desk]
     │
     ▼
[Provide Phone Number] ─── To staff
     │
     ▼
[Staff Checks Booking]
     │
     │ (Booking Found)        │ (No Booking)
     │                        │
     ▼                        ▼
[Check-in Flow]         [Walk-in Capacity?]
                              │
                    (Yes)     │     (No)
                      ▼       │       ▼
              [Create Walk-in │  [Join Waitlist]
               Booking]       │       │
                    │         │       ▼
                    ▼         │  [Notify if space]
              [Enter Pet      │
               Details]       │
                    │         │
                    ▼         │
              [Generate       │
               Queue #]       │
                    │         │
                    └─────────┘
                          │
                          ▼
                    [Wait for Call]
                          │
                          ▼
                    [Vaccination]
```

### 2.4 Certificate Download Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CERTIFICATE DOWNLOAD FLOW                        │
└─────────────────────────────────────────────────────────────────────┘

[SMS with Certificate Link]
     │
     ▼
[Click Link]
     │
     ▼
[Certificate Page]
     │
     ├─── View certificate details
     ├─── Scan QR code
     ├─── [Download PDF] ─────► Generate & download
     └─── [Share] ─────────────► Copy link / Social share
```

---

## 3. Staff Flows

### 3.1 Staff Login Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STAFF LOGIN FLOW                             │
└─────────────────────────────────────────────────────────────────────┘

[Staff Portal URL]
     │
     ▼
[Login Page]
     │
     ├─── Enter Email/Phone
     ├─── Enter Password
     │
     ▼
[Authentication] ─── Uses existing BPA auth
     │
     │ (Success)              │ (Failed)
     ▼                        ▼
[Select Campaign]        [Error Message]
     │                        │
     ▼                        └─► [Retry]
[Select Location]
     │
     ▼
[Staff Dashboard]
     │
     ├─── Today's schedule
     ├─── Check-in queue
     ├─── Search function
     └─── Quick actions
```

### 3.2 QR Scan Check-in Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      QR SCAN CHECK-IN FLOW                           │
└─────────────────────────────────────────────────────────────────────┘

[Staff Dashboard]
     │
     ▼
[Tap "Scan QR"]
     │
     ▼
[Camera Opens]
     │
     ▼
[Scan QR Code]
     │
     ▼
[Lookup Booking]
     │
     │ (Found)                │ (Not Found)
     │                        │
     ▼                        ▼
[Booking Details]        [Error: Invalid QR]
     │                        │
     ├─── Owner name          └─► [Manual Search]
     ├─── Phone number
     ├─── Pets list
     ├─── Appointment time
     ├─── Status
     │
     ▼
[Verify Status]
     │
     │ (Correct slot)    │ (Wrong day/time)    │ (Already checked-in)
     │                   │                      │
     ▼                   ▼                      ▼
[Confirm Check-in]  [Warning: Early/Late]  [Show "Already checked in"]
     │                   │
     ▼                   ▼
[Assign Queue #]    [Allow anyway?]
     │                   │
     │        (Yes)      │     (No)
     │          ▼        │       ▼
     │    [Check-in]     │  [Reschedule option]
     │          │        │
     └──────────┴────────┘
                │
                ▼
         [Booking Status Updated]
                │
                ▼
         [Print Queue Ticket] (Optional)
```

### 3.3 Phone Search Check-in Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PHONE SEARCH CHECK-IN FLOW                        │
└─────────────────────────────────────────────────────────────────────┘

[Staff Dashboard]
     │
     ▼
[Search Box]
     │
     ▼
[Enter Phone Number]
     │
     ▼
[Search Results]
     │
     │ (Found)                │ (Not Found)
     │                        │
     ▼                        ▼
[Bookings for Phone]     [No bookings found]
     │                        │
     │ (Multiple)   (Single)  └─► [Create Walk-in?]
     │     │           │
     ▼     │           │
[Select   └───────────►│
 Booking]              │
     │                 │
     └─────────────────┘
                │
                ▼
         [Booking Details]
                │
                ▼
         [Check-in Flow] (Same as QR scan)
```

### 3.4 Walk-in Registration Flow (Staff Side)

```
┌─────────────────────────────────────────────────────────────────────┐
│                  WALK-IN REGISTRATION FLOW (STAFF)                   │
└─────────────────────────────────────────────────────────────────────┘

[Staff Dashboard]
     │
     ▼
[Tap "Walk-in"]
     │
     ▼
[Check Walk-in Capacity]
     │
     │ (Available)            │ (Full)
     │                        │
     ▼                        ▼
[Enter Phone Number]     [Show "No capacity"]
     │                        │
     ▼                        └─► [Add to waitlist?]
[Check Existing Account]
     │
     │ (Exists)              │ (New)
     │                        │
     ▼                        ▼
[Load Owner Info]        [Enter Owner Name]
     │                        │
     └────────────────────────┘
                │
                ▼
         [Enter Pet Details]
                │
         ├─── Pet 1
         ├─── [+ Add Another Pet]
                │
                ▼
         [Confirm Walk-in]
                │
                ▼
         [Generate Booking + Queue #]
                │
                ▼
         [SMS Sent to Owner]
                │
                ▼
         [Ready for Vaccination]
```

### 3.5 Vaccination Recording Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    VACCINATION RECORDING FLOW                        │
└─────────────────────────────────────────────────────────────────────┘

[Queue Display / Call Next]
     │
     ▼
[Select Booking from Queue]
     │
     ▼
[Booking Details]
     │
     ├─── Owner info
     ├─── Pets to vaccinate
     │
     ▼
[For Each Pet:]
     │
     ▼
[Pre-vaccination Checklist]
     │
     ├─── Cat appears healthy? [Yes/No]
     ├─── Any recent illness? [Yes/No]
     ├─── Currently on medication? [Yes/No]
     │
     │ (All OK)              │ (Issue flagged)
     │                        │
     ▼                        ▼
[Select Vaccine]         [Add Note / Defer?]
     │
     ▼
[Enter Batch Details]
     │
     ├─── Vaccine Type (Pre-selected)
     ├─── Batch Number (Required)
     ├─── Lot Number (Optional)
     ├─── Expiry Date (Auto-validated)
     │
     ▼
[Confirm Administration]
     │
     ▼
[Record Administering Staff] ─── Auto-filled from login
     │
     ▼
[Add Notes] (Optional)
     │
     ▼
[Save Vaccination]
     │
     ▼
[Vaccination Saved]
     │
     ├─── Certificate Generated
     ├─── SMS Sent to Owner
     │
     ▼
[Next Pet or Complete]
     │
     │ (More pets)           │ (All done)
     │                        │
     ▼                        ▼
[Repeat for next pet]   [Booking Completed]
                              │
                              ▼
                        [Print Certificate?]
```

### 3.6 No-Show Handling Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                       NO-SHOW HANDLING FLOW                          │
└─────────────────────────────────────────────────────────────────────┘

[End of Time Slot]
     │
     ▼
[Review Unchecked Bookings]
     │
     ▼
[For Each Unchecked:]
     │
     ▼
[Mark as No-Show?]
     │
     │ (Yes)                  │ (Wait)
     │                        │
     ▼                        ▼
[Confirm No-Show]        [Keep in Queue]
     │
     ▼
[Send Options]
     │
     ├─── [Send No-Show SMS]
     ├─── [Offer Reschedule Link]
     │
     ▼
[Booking Status: NO_SHOW]
     │
     ▼
[Slot Released for Walk-ins]
```

---

## 4. Admin Flows

### 4.1 Campaign Creation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CAMPAIGN CREATION FLOW                          │
└─────────────────────────────────────────────────────────────────────┘

[Admin Dashboard]
     │
     ▼
[Campaigns → New Campaign]
     │
     ▼
[Basic Information]
     │
     ├─── Campaign Name
     ├─── Description
     ├─── Start Date
     ├─── End Date
     ├─── Vaccine Types (Multi-select)
     ├─── Pricing (Free/Paid + Amount)
     │
     ▼
[Add Locations]
     │
     ├─── Location Name
     ├─── Address
     ├─── Coordinates (Map picker)
     ├─── Contact Number
     │
     ▼
[Configure Slots per Location]
     │
     ├─── Operating Days (Mon-Sun checkboxes)
     ├─── Time Slots:
     │     ├─── Slot 1: 09:00-12:00, Capacity: 50
     │     ├─── Slot 2: 14:00-17:00, Capacity: 50
     │
     ▼
[Staff Assignment]
     │
     ├─── Select staff from BPA system
     ├─── Assign roles (Check-in/Vaccinator/Admin)
     │
     ▼
[Review & Save]
     │
     ▼
[Campaign Created (DRAFT)]
     │
     ▼
[Publish Campaign?]
     │
     │ (Yes)                  │ (No)
     │                        │
     ▼                        ▼
[Campaign ACTIVE]        [Stay in DRAFT]
```

### 4.2 Dashboard & Monitoring Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DASHBOARD & MONITORING FLOW                       │
└─────────────────────────────────────────────────────────────────────┘

[Admin Dashboard]
     │
     ▼
[Campaign Overview]
     │
     ├─── Total Bookings: XXX
     ├─── Today's Appointments: XX
     ├─── Completed Vaccinations: XXX
     ├─── No-Shows: XX
     │
     ▼
[Real-time View]
     │
     ├─── Live check-ins
     ├─── Queue status by location
     ├─── Slot fill rates
     │
     ▼
[Drill Down]
     │
     ├─── By Location
     ├─── By Date
     ├─── By Staff
     │
     ▼
[Actions]
     │
     ├─── [Pause Bookings]
     ├─── [Send Announcement]
     ├─── [Adjust Capacity]
     └─── [Generate Report]
```

---

## 5. Public Verification Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PUBLIC VERIFICATION FLOW                          │
└─────────────────────────────────────────────────────────────────────┘

[Scan QR Code on Certificate]
     │
     ▼
[Opens Verification URL]
     │
     ▼
[Verification Page]
     │
     ▼
[System Validates Token]
     │
     │ (Valid)                │ (Invalid)
     │                        │
     ▼                        ▼
[Show Verification]      [Show Error]
     │                        │
     ├─── ✓ Valid Certificate │
     ├─── Pet Name            ├─── Certificate not found
     ├─── Vaccine Type        ├─── May be revoked
     ├─── Date Administered   └─── Contact support link
     ├─── Issuing Organization
     │
     ▼
[Optional: Report Issue]
```

---

## 6. State Diagrams

### 6.1 Booking States

```
              ┌────────────┐
              │   DRAFT    │ (During creation)
              └─────┬──────┘
                    │ Submit
                    ▼
              ┌────────────┐
      ┌───────│ CONFIRMED  │───────┐
      │       └─────┬──────┘       │
      │ Cancel      │ Check-in     │ No-show
      ▼             ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│ CANCELLED  │ │ CHECKED_IN │ │  NO_SHOW   │
└────────────┘ └─────┬──────┘ └────────────┘
                     │ Complete
                     ▼
              ┌────────────┐
              │ COMPLETED  │
              └────────────┘
```

### 6.2 Vaccination Record States

```
┌────────────┐
│   ACTIVE   │ (Normal state)
└─────┬──────┘
      │
      ├─────── Correction ─────► ┌────────────┐
      │                          │ CORRECTED  │
      │                          └────────────┘
      │
      └─────── Void ───────────► ┌────────────┐
                                 │   VOIDED   │
                                 └────────────┘
```

### 6.3 Campaign States

```
┌────────────┐
│   DRAFT    │
└─────┬──────┘
      │ Publish
      ▼
┌────────────┐
│   ACTIVE   │◄────────┐
└─────┬──────┘         │
      │ Pause          │ Resume
      ▼                │
┌────────────┐         │
│   PAUSED   │─────────┘
└─────┬──────┘
      │ End date reached
      ▼
┌────────────┐
│ COMPLETED  │
└────────────┘
```

---

## 7. Error Handling Flows

### 7.1 OTP Failure
- Max 3 attempts
- After 3 failures: 5-minute cooldown
- Show "Request new OTP" option

### 7.2 Payment Failure
- Show error message
- Offer retry
- Preserve booking for 15 minutes
- Release slot if abandoned

### 7.3 Network Error (Staff Portal)
- Local queue caching
- Retry mechanism
- Offline mode for check-in (sync later)

### 7.4 QR Scan Failure
- Fall back to phone search
- Manual booking lookup
- Report damaged QR option
