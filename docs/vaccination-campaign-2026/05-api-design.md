# API Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. API Overview

### 1.1 Base URL
```
Production: https://api.bpa.com.bd/api/v1
Staging:    https://api-staging.bpa.com.bd/api/v1
```

### 1.2 Authentication Methods

| Method | Use Case | Header |
|--------|----------|--------|
| Public OTP Session | Pet owners | `Authorization: Bearer <otp_session_token>` |
| Staff JWT | Staff portal | `Authorization: Bearer <staff_jwt>` |
| API Key | Admin/Internal | `X-API-Key: <api_key>` |

### 1.3 Common Response Format

```typescript
// Success Response
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-06-15T10:30:00Z"
  }
}

// Error Response
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid phone number format",
    "details": [
      { "field": "phone", "message": "Must be valid BD mobile number" }
    ]
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-06-15T10:30:00Z"
  }
}
```

---

## 2. Public APIs (No Auth Required)

### 2.1 Campaign Listing

#### GET /campaign

List active public campaigns.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Filter by status (default: ACTIVE) |
| limit | number | No | Results per page (default: 20, max: 100) |
| offset | number | No | Pagination offset |

**Response:**
```json
{
  "success": true,
  "data": {
    "campaigns": [
      {
        "id": 1,
        "name": "2026 Cat Flu + Rabies Campaign",
        "slug": "cat-flu-rabies-2026",
        "description": "Free vaccination for all cats...",
        "startDate": "2026-07-01",
        "endDate": "2026-08-31",
        "pricingType": "FREE",
        "priceAmount": null,
        "status": "ACTIVE",
        "locationsCount": 5,
        "vaccineTypes": [
          { "id": 1, "name": "Rabies" },
          { "id": 2, "name": "Cat Flu (FVRCP)" }
        ]
      }
    ],
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

#### GET /campaign/:id

Get campaign details with locations.

**Response:**
```json
{
  "success": true,
  "data": {
    "campaign": {
      "id": 1,
      "name": "2026 Cat Flu + Rabies Campaign",
      "slug": "cat-flu-rabies-2026",
      "description": "...",
      "startDate": "2026-07-01",
      "endDate": "2026-08-31",
      "pricingType": "FREE",
      "maxPetsPerBooking": 5,
      "minAdvanceHours": 24,
      "allowWalkIns": true,
      "locations": [
        {
          "id": 1,
          "name": "Dhaka Central Vet Clinic",
          "address": "123 Main Road, Dhaka",
          "latitude": 23.8103,
          "longitude": 90.4125,
          "contactPhone": "01712345678",
          "dailyCapacity": 100
        }
      ],
      "vaccineTypes": [
        {
          "id": 1,
          "name": "Rabies",
          "description": "Rabies vaccine for cats"
        }
      ]
    }
  }
}
```

#### GET /campaign/:id/slots/availability

Get slot availability for a date range.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| locationId | number | Yes | Location ID |
| from | date | Yes | Start date (YYYY-MM-DD) |
| to | date | No | End date (default: from + 7 days) |

**Response:**
```json
{
  "success": true,
  "data": {
    "locationId": 1,
    "dates": [
      {
        "date": "2026-07-15",
        "slots": [
          {
            "id": 101,
            "startTime": "09:00",
            "endTime": "12:00",
            "capacity": 50,
            "available": 35,
            "status": "OPEN"
          },
          {
            "id": 102,
            "startTime": "14:00",
            "endTime": "17:00",
            "capacity": 50,
            "available": 0,
            "status": "FULL"
          }
        ]
      }
    ]
  }
}
```

### 2.2 Certificate Verification

#### GET /campaign-certificate/:token/verify

Public verification of vaccination certificate.

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "certificate": {
      "petName": "Mittens",
      "petType": "Cat",
      "vaccineName": "Rabies",
      "administeredDate": "2026-07-15",
      "issuingOrganization": "Bangladesh Pet Alliance",
      "verificationCode": "CERT-ABC12345"
    }
  }
}
```

---

## 2.3 Express Checkout APIs (3-step booking — no OTP)

Payment-first flow: checkout session created before booking row. Booking is fulfilled after payment webhook (or immediately for free campaigns).

#### GET /campaign/public/campaigns/:slug/booking-areas

List active rollout regions with remaining capacity.

#### POST /campaign/public/checkout/init

**Request:** phone, area (divisionId, districtId, upazilaId), fullAddress, catCount, optional alternatePhone, couponCode, paymentMethod, returnUrl, cancelUrl.

**Response (paid):** `{ checkoutId, amount, requiresPayment: true, paymentUrl, expiresAt }`

**Response (free):** `{ checkoutId, amount: 0, requiresPayment: false }`

#### POST /campaign/public/checkout/confirm-free

**Request:** `{ checkoutId }` — creates booking immediately for free campaigns.

#### GET /campaign/public/checkout/:checkoutId/status

Poll after payment gateway redirect until `status === FULFILLED`.

#### POST /campaign/public/booking/claim

**Request:** `{ phone, bookingRef, verificationCode }` — replaces OTP-based VIEW_BOOKING for public lookup.

**Response:** `BookingDetails` including `verificationCode` and `qrToken`.

Legacy OTP booking endpoints (`POST /campaign/booking/`) remain for backward compatibility.

---

### 3.1 Request OTP

#### POST /campaign-otp/request

Request OTP for phone verification.

**Request:**
```json
{
  "phone": "01712345678",
  "purpose": "BOOKING"  // BOOKING | VIEW_BOOKING
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "OTP sent successfully",
    "expiresIn": 300,
    "retryAfter": 60
  }
}
```

**Error Responses:**
- `429 Too Many Requests` - Rate limited
- `400 Bad Request` - Invalid phone format

### 3.2 Verify OTP

#### POST /campaign-otp/verify

Verify OTP and get session token.

**Request:**
```json
{
  "phone": "01712345678",
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresAt": "2026-07-16T10:30:00Z",
    "user": {
      "phone": "01712345678",
      "name": "Existing User",  // null if new
      "hasBpaAccount": true
    }
  }
}
```

---

## 4. Booking APIs (OTP Auth Required)

### 4.1 Create Booking

#### POST /campaign-booking

Create a new booking.

**Request:**
```json
{
  "campaignId": 1,
  "locationId": 1,
  "slotId": 101,
  "owner": {
    "name": "John Doe",
    "address": {
      "division": "Dhaka",
      "district": "Dhaka",
      "area": "Dhanmondi"
    }
  },
  "pets": [
    {
      "name": "Mittens",
      "breedId": null,
      "gender": "FEMALE",
      "ageMonths": 24,
      "colorDescription": "Orange tabby"
    },
    {
      "name": "Whiskers",
      "gender": "MALE",
      "ageMonths": 12
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": 1001,
      "bookingRef": "VAC-ABC123",
      "qrToken": "a1b2c3d4e5f6g7h8",
      "qrCodeUrl": "https://cdn.bpa.com.bd/qr/a1b2c3d4e5f6g7h8.png",
      "status": "CONFIRMED",
      "campaign": {
        "id": 1,
        "name": "2026 Cat Flu + Rabies Campaign"
      },
      "location": {
        "id": 1,
        "name": "Dhaka Central Vet Clinic",
        "address": "123 Main Road, Dhaka"
      },
      "slot": {
        "date": "2026-07-15",
        "startTime": "09:00",
        "endTime": "12:00"
      },
      "owner": {
        "phone": "01712345678",
        "name": "John Doe"
      },
      "pets": [
        { "id": 1, "name": "Mittens" },
        { "id": 2, "name": "Whiskers" }
      ],
      "petCount": 2,
      "createdAt": "2026-07-10T08:30:00Z"
    },
    "smsStatus": "SENT"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Validation error
- `409 Conflict` - Slot no longer available
- `422 Unprocessable Entity` - Business rule violation

### 4.2 Get Booking by Reference

#### GET /campaign-booking/:ref

Get booking details by reference number.

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": 1001,
      "bookingRef": "VAC-ABC123",
      "qrToken": "a1b2c3d4e5f6g7h8",
      "status": "CONFIRMED",
      "campaign": { ... },
      "location": { ... },
      "slot": {
        "date": "2026-07-15",
        "startTime": "09:00",
        "endTime": "12:00"
      },
      "owner": {
        "phone": "01712345678",
        "name": "John Doe"
      },
      "pets": [
        {
          "id": 1,
          "name": "Mittens",
          "gender": "FEMALE",
          "vaccinationStatus": "PENDING"
        }
      ],
      "canReschedule": true,
      "canCancel": true
    }
  }
}
```

### 4.3 Get Bookings by Phone

#### POST /campaign-booking/by-phone

Get all bookings for authenticated phone.

**Response:**
```json
{
  "success": true,
  "data": {
    "bookings": [
      {
        "id": 1001,
        "bookingRef": "VAC-ABC123",
        "status": "CONFIRMED",
        "campaign": { "id": 1, "name": "..." },
        "slot": { "date": "2026-07-15", "startTime": "09:00" },
        "petCount": 2
      },
      {
        "id": 1002,
        "bookingRef": "VAC-XYZ789",
        "status": "COMPLETED",
        "campaign": { "id": 1, "name": "..." },
        "slot": { "date": "2026-07-10", "startTime": "14:00" },
        "petCount": 1,
        "certificates": [
          { "petName": "Luna", "token": "cert123" }
        ]
      }
    ]
  }
}
```

### 4.4 Reschedule Booking

#### PUT /campaign-booking/:ref/reschedule

Reschedule to a different slot.

**Request:**
```json
{
  "newSlotId": 105
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "bookingRef": "VAC-ABC123",
      "status": "CONFIRMED",
      "slot": {
        "date": "2026-07-20",
        "startTime": "09:00",
        "endTime": "12:00"
      }
    },
    "smsStatus": "SENT"
  }
}
```

### 4.5 Cancel Booking

#### DELETE /campaign-booking/:ref

Cancel a booking.

**Request:**
```json
{
  "reason": "Cannot attend"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "bookingRef": "VAC-ABC123",
      "status": "CANCELLED",
      "cancelledAt": "2026-07-12T10:00:00Z"
    },
    "refund": {
      "applicable": true,
      "amount": 500,
      "status": "PROCESSING"
    }
  }
}
```

---

## 5. Staff APIs (Staff JWT Required)

### 5.1 Check-in APIs

#### POST /campaign-checkin/scan

Check-in by QR scan.

**Request:**
```json
{
  "qrToken": "a1b2c3d4e5f6g7h8",
  "locationId": 1
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": 1001,
      "bookingRef": "VAC-ABC123",
      "status": "CONFIRMED",
      "owner": {
        "phone": "01712345678",
        "name": "John Doe"
      },
      "pets": [
        { "id": 1, "name": "Mittens", "status": "PENDING" },
        { "id": 2, "name": "Whiskers", "status": "PENDING" }
      ],
      "slot": {
        "date": "2026-07-15",
        "startTime": "09:00"
      }
    },
    "validation": {
      "isValidSlot": true,
      "isOnTime": true,
      "warnings": []
    }
  }
}
```

#### POST /campaign-checkin/phone

Check-in by phone lookup.

**Request:**
```json
{
  "phone": "01712345678",
  "locationId": 1,
  "date": "2026-07-15"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "bookings": [
      {
        "id": 1001,
        "bookingRef": "VAC-ABC123",
        "slot": { "startTime": "09:00" },
        "status": "CONFIRMED",
        "petCount": 2
      }
    ]
  }
}
```

#### POST /campaign-checkin/:bookingId/arrive

Mark booking as checked-in.

**Request:**
```json
{
  "assignQueue": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": 1001,
      "status": "CHECKED_IN",
      "checkedInAt": "2026-07-15T09:15:00Z",
      "queueNumber": "A042"
    }
  }
}
```

### 5.2 Walk-in Registration

#### POST /campaign-checkin/walk-in

Register a walk-in.

**Request:**
```json
{
  "campaignId": 1,
  "locationId": 1,
  "owner": {
    "phone": "01798765432",
    "name": "Jane Smith"
  },
  "pets": [
    {
      "name": "Fluffy",
      "gender": "FEMALE",
      "ageMonths": 8
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": 1005,
      "bookingRef": "VAC-WLK456",
      "isWalkIn": true,
      "status": "CHECKED_IN",
      "queueNumber": "W015",
      "pets": [
        { "id": 5, "name": "Fluffy" }
      ]
    }
  }
}
```

#### GET /campaign-checkin/queue

Get current queue status.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| locationId | number | Yes | Location ID |

**Response:**
```json
{
  "success": true,
  "data": {
    "queue": {
      "locationId": 1,
      "currentNumber": "A040",
      "waiting": 15,
      "inProgress": 3,
      "items": [
        {
          "queueNumber": "A038",
          "bookingRef": "VAC-ABC123",
          "ownerName": "John Doe",
          "petCount": 2,
          "status": "IN_PROGRESS"
        }
      ]
    }
  }
}
```

### 5.3 Vaccination Recording

#### POST /campaign-vaccination

Record a vaccination.

**Request:**
```json
{
  "bookingId": 1001,
  "campaignPetId": 1,
  "vaccineTypeId": 1,
  "batchNumber": "RAB-2026-001",
  "lotNumber": "L12345",
  "expiryDate": "2027-06-30",
  "notes": "No adverse reaction",
  "preCheckPassed": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "vaccination": {
      "id": 5001,
      "petId": 101,  // Permanent pet ID (created/linked)
      "vaccineType": { "id": 1, "name": "Rabies" },
      "administeredAt": "2026-07-15T10:30:00Z",
      "batchNumber": "RAB-2026-001",
      "certificateToken": "CERT-XYZ78901"
    },
    "certificate": {
      "token": "CERT-XYZ78901",
      "downloadUrl": "https://api.bpa.com.bd/api/v1/campaign-certificate/CERT-XYZ78901/pdf"
    },
    "campaignPet": {
      "id": 1,
      "vaccinationStatus": "COMPLETED"
    },
    "booking": {
      "id": 1001,
      "allPetsVaccinated": false,
      "pendingPets": [{ "id": 2, "name": "Whiskers" }]
    }
  }
}
```

#### POST /campaign-vaccination/:id/void

Void a vaccination record.

**Request:**
```json
{
  "reason": "Incorrect batch number recorded"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "vaccination": {
      "id": 5001,
      "status": "VOIDED",
      "voidedAt": "2026-07-15T11:00:00Z",
      "voidReason": "Incorrect batch number recorded"
    }
  }
}
```

### 5.4 No-Show Management

#### POST /campaign-checkin/:bookingId/no-show

Mark as no-show.

**Request:**
```json
{
  "sendSms": true,
  "offerReschedule": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": 1001,
      "status": "NO_SHOW"
    },
    "smsStatus": "SENT",
    "rescheduleLink": "https://vacc.bpa.com.bd/reschedule/VAC-ABC123"
  }
}
```

---

## 6. Admin APIs (Admin Auth Required)

### 6.1 Campaign Management

#### POST /campaign

Create a new campaign.

**Request:**
```json
{
  "name": "2026 Cat Flu + Rabies Campaign",
  "slug": "cat-flu-rabies-2026",
  "description": "...",
  "startDate": "2026-07-01",
  "endDate": "2026-08-31",
  "pricingType": "FREE",
  "maxPetsPerBooking": 5,
  "minAdvanceHours": 24,
  "allowWalkIns": true,
  "walkInQuotaPercent": 20,
  "vaccineTypeIds": [1, 2],
  "locations": [
    {
      "name": "Dhaka Central",
      "address": "...",
      "latitude": 23.8103,
      "longitude": 90.4125,
      "contactPhone": "01712345678",
      "dailyCapacity": 100,
      "slots": [
        { "startTime": "09:00", "endTime": "12:00", "capacity": 50 },
        { "startTime": "14:00", "endTime": "17:00", "capacity": 50 }
      ],
      "operatingDays": [1, 2, 3, 4, 5, 6]  // Mon-Sat
    }
  ]
}
```

#### PUT /campaign/:id/status

Update campaign status.

**Request:**
```json
{
  "status": "ACTIVE"
}
```

### 6.2 Dashboard & Reports

#### GET /campaign-admin/dashboard

Get campaign dashboard stats.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| campaignId | number | Yes | Campaign ID |

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalBookings": 1500,
      "totalVaccinations": 1200,
      "totalPets": 2100,
      "noShows": 150,
      "walkIns": 300
    },
    "today": {
      "bookings": 120,
      "checkedIn": 85,
      "vaccinated": 70,
      "pending": 50
    },
    "byLocation": [
      {
        "locationId": 1,
        "name": "Dhaka Central",
        "bookings": 500,
        "vaccinations": 400
      }
    ],
    "trend": [
      { "date": "2026-07-10", "bookings": 100, "vaccinations": 80 },
      { "date": "2026-07-11", "bookings": 120, "vaccinations": 95 }
    ]
  }
}
```

#### GET /campaign-admin/reports/:type

Generate reports.

**Types:** `daily`, `weekly`, `location`, `vaccine-usage`, `demographics`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| campaignId | number | Yes | Campaign ID |
| from | date | No | Start date |
| to | date | No | End date |
| format | string | No | `json` or `csv` |

**Response (JSON):**
```json
{
  "success": true,
  "data": {
    "report": {
      "type": "daily",
      "period": { "from": "2026-07-15", "to": "2026-07-15" },
      "data": {
        "bookings": 120,
        "vaccinations": 100,
        "noShows": 15,
        "bySlot": [
          { "time": "09:00-12:00", "count": 60 },
          { "time": "14:00-17:00", "count": 60 }
        ]
      }
    }
  }
}
```

---

## 7. Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict (e.g., slot full) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `OTP_EXPIRED` | 400 | OTP has expired |
| `OTP_INVALID` | 400 | OTP is incorrect |
| `SLOT_UNAVAILABLE` | 409 | Slot no longer available |
| `BOOKING_NOT_MODIFIABLE` | 422 | Cannot modify booking |
| `CAMPAIGN_INACTIVE` | 422 | Campaign not accepting bookings |

---

## 8. Rate Limits

| Endpoint Pattern | Limit | Window | Key |
|------------------|-------|--------|-----|
| `/campaign-otp/request` | 3 | 1 min | phone |
| `/campaign-otp/verify` | 5 | 5 min | phone |
| `/campaign-booking` | 10 | 1 min | session |
| `/campaign-checkin/*` | 60 | 1 min | user |
| `/campaign-vaccination` | 30 | 1 min | user |
| `/campaign-certificate/*/verify` | 100 | 1 min | IP |

---

## 9. Webhook Events (Optional)

For integrations, the following webhooks can be configured:

| Event | Payload |
|-------|---------|
| `booking.created` | Booking object |
| `booking.cancelled` | Booking object |
| `vaccination.completed` | Vaccination object |
| `campaign.status_changed` | Campaign object |

**Webhook Format:**
```json
{
  "event": "booking.created",
  "timestamp": "2026-07-15T10:30:00Z",
  "data": { ... }
}
```
