# BPA App Linking Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

This document outlines how campaign data (pets, vaccinations, certificates) will be linked to the main BPA app (`bpa_app`) for users who later register for the full BPA experience.

### 1.1 Key Principle

> Mobile number is the universal identifier for linking campaign data to BPA accounts.

### 1.2 Linking Scenarios

| Scenario | User Journey |
|----------|--------------|
| New BPA User | Campaign participant later downloads BPA app and registers |
| Existing BPA User | User with BPA account books through campaign site |
| Post-Campaign Discovery | User verifies certificate and decides to download app |

---

## 2. Data Model for Linking

### 2.1 Campaign-Side Data

```
CampaignBooking
├── ownerPhone (primary identifier)
├── ownerName
├── userId (nullable - set if linked)
└── CampaignPet[]
    ├── name
    ├── breedId
    ├── linkedPetId (nullable - set if linked)
    └── vaccinationId (existing Vaccination record)
```

### 2.2 BPA-Side Data

```
User
├── id
├── phone
└── Pet[]
    ├── id
    ├── name
    └── Vaccination[]
        ├── id
        └── campaignPetId (back-reference)
```

### 2.3 Linking Fields in Prisma

```prisma
// Extension to CampaignBooking
model CampaignBooking {
  // ... existing fields
  
  // Linking to BPA user (set when user registers)
  userId        Int?
  user          User?         @relation(fields: [userId], references: [id])
  linkedAt      DateTime?     // When the account was linked
  
  // Link source tracking
  linkSource    LinkSource?   // How the link was established
}

enum LinkSource {
  APP_REGISTRATION    // User registered in BPA app after campaign
  EXISTING_USER       // User already had BPA account
  CERTIFICATE_CLAIM   // Claimed via certificate verification
  MANUAL_LINK        // Staff manually linked accounts
}

// Extension to CampaignPet
model CampaignPet {
  // ... existing fields
  
  // Link to permanent pet record
  linkedPetId   Int?
  linkedPet     Pet?          @relation(fields: [linkedPetId], references: [id])
  linkedAt      DateTime?
}
```

---

## 3. Linking Flows

### 3.1 Flow A: New BPA App Registration

```
┌───────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│   CAMPAIGN SITE                BPA BACKEND              BPA APP          │
│                                                                           │
│   ┌─────────────┐                                                        │
│   │ User books  │                                                        │
│   │ vaccination │                                                        │
│   │ Phone: 017X │                                                        │
│   └──────┬──────┘                                                        │
│          │                                                                │
│          ▼                                                                │
│   ┌─────────────┐                                                        │
│   │ CampaignPet │                                                        │
│   │ created     │                                                        │
│   │ (no userId) │                                                        │
│   └──────┬──────┘                                                        │
│          │                                                                │
│          │    Months later...                         ┌─────────────┐    │
│          │                                            │ User installs│    │
│          │                                            │ BPA app     │    │
│          │                                            └──────┬──────┘    │
│          │                                                   │           │
│          │                                                   ▼           │
│          │                                            ┌─────────────┐    │
│          │                                            │ Registers   │    │
│          │                                            │ Phone: 017X │    │
│          │                                            └──────┬──────┘    │
│          │                                                   │           │
│          │                  ┌─────────────┐                  │           │
│          │                  │ Auto-detect │◄─────────────────┘           │
│          │                  │ campaign    │                              │
│          └─────────────────►│ records     │                              │
│                             └──────┬──────┘                              │
│                                    │                                      │
│                                    ▼                                      │
│                             ┌─────────────┐                              │
│                             │ Link prompt │                              │
│                             │ "We found   │                              │
│                             │ campaign    │                              │
│                             │ records"    │                              │
│                             └──────┬──────┘                              │
│                                    │                                      │
│                                    ▼                                      │
│                             ┌─────────────┐                              │
│                             │ Create User │                              │
│                             │ Create Pets │                              │
│                             │ Link records│                              │
│                             └─────────────┘                              │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Flow B: Existing BPA User on Campaign Site

```
┌───────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│   CAMPAIGN SITE                BPA BACKEND                               │
│                                                                           │
│   ┌─────────────┐                                                        │
│   │ User enters │                                                        │
│   │ phone: 017X │                                                        │
│   └──────┬──────┘                                                        │
│          │                                                                │
│          ▼                                                                │
│   ┌─────────────┐         ┌─────────────┐                                │
│   │ OTP sent    │────────►│ Check if    │                                │
│   └─────────────┘         │ user exists │                                │
│                           └──────┬──────┘                                │
│                                  │                                        │
│                           ┌──────┴──────┐                                │
│                           │             │                                │
│                           ▼             ▼                                │
│                    ┌──────────┐  ┌──────────┐                           │
│                    │ Existing │  │ New User │                           │
│                    │ User     │  │          │                           │
│                    └────┬─────┘  └────┬─────┘                           │
│                         │             │                                  │
│                         ▼             ▼                                  │
│                  ┌───────────┐  ┌───────────┐                           │
│                  │ Auto-link │  │ Create    │                           │
│                  │ booking   │  │ booking   │                           │
│                  │ to userId │  │ (no link) │                           │
│                  └───────────┘  └───────────┘                           │
│                         │                                                │
│                         ▼                                                │
│                  ┌───────────┐                                          │
│                  │ Show      │                                          │
│                  │ existing  │                                          │
│                  │ pets      │                                          │
│                  └───────────┘                                          │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Flow C: Certificate Claim Link

```
User receives certificate SMS
    ↓
Opens verification URL
    ↓
Sees "Claim in BPA App" button
    ↓
Deep link opens BPA app
    ↓
If not logged in: Prompt login/register
    ↓
Link certificate/pet to account
```

---

## 4. Backend Implementation

### 4.1 Check for Existing User During Booking

```typescript
// services/campaignLinking.service.ts

async function checkExistingUser(phone: string): Promise<ExistingUserInfo | null> {
  const user = await prisma.user.findFirst({
    where: {
      auth: { phone },
      status: 'ACTIVE',
    },
    include: {
      auth: { select: { phone: true } },
      pets: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          type: { select: { name: true } },
          breed: { select: { name: true } },
        },
      },
    },
  });
  
  if (!user) return null;
  
  return {
    userId: user.id,
    name: user.name,
    hasPets: user.pets.length > 0,
    pets: user.pets,
  };
}

// Called during booking creation
async function createBookingWithLink(data: BookingData): Promise<CampaignBooking> {
  const existingUser = await checkExistingUser(data.phone);
  
  const booking = await prisma.campaignBooking.create({
    data: {
      ...data,
      userId: existingUser?.userId ?? null,
      linkSource: existingUser ? 'EXISTING_USER' : null,
      linkedAt: existingUser ? new Date() : null,
    },
  });
  
  // If existing user, prompt to select existing pets
  if (existingUser?.hasPets) {
    // Return flag to show pet selection UI
  }
  
  return booking;
}
```

### 4.2 Link Existing Pet to Campaign Pet

```typescript
async function linkExistingPet(
  campaignPetId: number,
  existingPetId: number,
  userId: number
): Promise<void> {
  // Verify ownership
  const pet = await prisma.pet.findFirst({
    where: {
      id: existingPetId,
      userId,
      status: 'ACTIVE',
    },
  });
  
  if (!pet) {
    throw new ApiError('PET_NOT_FOUND', 'Pet not found or not owned by user', 404);
  }
  
  // Update campaign pet with link
  await prisma.campaignPet.update({
    where: { id: campaignPetId },
    data: {
      linkedPetId: existingPetId,
      linkedAt: new Date(),
    },
  });
  
  // When vaccination is recorded, it will be linked to the permanent pet
}
```

### 4.3 Post-Registration Linking

```typescript
// Called after new user registration in BPA app
async function linkCampaignRecordsToNewUser(userId: number, phone: string): Promise<LinkResult> {
  // Find all unlinked campaign bookings for this phone
  const unlinkedBookings = await prisma.campaignBooking.findMany({
    where: {
      ownerPhone: phone,
      userId: null,
    },
    include: {
      campaignPets: {
        include: {
          vaccination: true,
        },
      },
    },
  });
  
  if (!unlinkedBookings.length) {
    return { linked: false, bookings: 0, pets: 0 };
  }
  
  const result = {
    linked: true,
    bookings: unlinkedBookings.length,
    pets: 0,
    vaccinations: 0,
  };
  
  for (const booking of unlinkedBookings) {
    await prisma.$transaction(async (tx) => {
      // Link booking to user
      await tx.campaignBooking.update({
        where: { id: booking.id },
        data: {
          userId,
          linkSource: 'APP_REGISTRATION',
          linkedAt: new Date(),
        },
      });
      
      // Create or link pets
      for (const campaignPet of booking.campaignPets) {
        // Check if pet already exists by name (fuzzy match)
        let pet = await tx.pet.findFirst({
          where: {
            userId,
            name: { equals: campaignPet.name, mode: 'insensitive' },
          },
        });
        
        if (!pet) {
          // Create new pet in BPA system
          pet = await tx.pet.create({
            data: {
              userId,
              name: campaignPet.name,
              typeId: campaignPet.animalTypeId ?? DEFAULT_CAT_TYPE_ID,
              breedId: campaignPet.breedId,
              gender: campaignPet.gender,
              status: 'ACTIVE',
            },
          });
          result.pets++;
        }
        
        // Link campaign pet to BPA pet
        await tx.campaignPet.update({
          where: { id: campaignPet.id },
          data: {
            linkedPetId: pet.id,
            linkedAt: new Date(),
          },
        });
        
        // If vaccination exists, update it to point to the BPA pet
        if (campaignPet.vaccination) {
          await tx.vaccination.update({
            where: { id: campaignPet.vaccination.id },
            data: { petId: pet.id },
          });
          result.vaccinations++;
        }
      }
    });
  }
  
  return result;
}
```

---

## 5. BPA App UI for Linking

### 5.1 Post-Registration Link Prompt

```
┌─────────────────────────────────────────┐
│                                         │
│    🎉 Welcome to BPA!                   │
│                                         │
│    We found records from the            │
│    2026 Vaccination Campaign            │
│                                         │
│    ─────────────────────────────────    │
│                                         │
│    📋 2 Bookings                        │
│    🐱 3 Pets                            │
│    💉 3 Vaccinations                    │
│                                         │
│    Would you like to import these       │
│    into your BPA account?               │
│                                         │
│    ┌───────────────────────────────┐    │
│    │     Yes, Import Records       │    │
│    └───────────────────────────────┘    │
│                                         │
│    [ Maybe Later ]                      │
│                                         │
└─────────────────────────────────────────┘
```

### 5.2 Import Review Screen

```
┌─────────────────────────────────────────┐
│ ←  Review Import                        │
├─────────────────────────────────────────┤
│                                         │
│   The following will be added to your   │
│   BPA account:                          │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   PETS                                  │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ 🐱 Mittens                    │     │
│   │    Persian • Female           │     │
│   │    ✓ Rabies vaccination       │     │
│   │    ✓ Cat Flu vaccination      │     │
│   └───────────────────────────────┘     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ 🐱 Whiskers                   │     │
│   │    Mixed • Male               │     │
│   │    ✓ Rabies vaccination       │     │
│   └───────────────────────────────┘     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ⚠️ Already have these pets?           │
│   [ Link to existing pets instead ]     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │      Confirm Import           │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### 5.3 Link to Existing Pet

```
┌─────────────────────────────────────────┐
│ ←  Link Pet                             │
├─────────────────────────────────────────┤
│                                         │
│   Campaign Pet: Mittens                 │
│                                         │
│   Which of your existing pets is this?  │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ ⚪ Mittens (from BPA)         │     │
│   │    Persian • 2 years          │     │
│   │    Last visit: March 2026     │     │
│   └───────────────────────────────┘     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ ⚪ Fluffy                     │     │
│   │    Siamese • 1 year           │     │
│   └───────────────────────────────┘     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ⚪ This is a different pet            │
│      (create new)                       │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │         Link Pet              │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

---

## 6. Deep Linking

### 6.1 Certificate to App Link

```typescript
// Certificate verification page shows "View in BPA App" button
const appLink = generateAppDeepLink(certificateToken);

function generateAppDeepLink(certToken: string): string {
  const androidLink = `bpa://certificate/${certToken}`;
  const iosLink = `bpa://certificate/${certToken}`;
  const webFallback = `https://app.bpa.com.bd/certificate/${certToken}`;
  
  // For smart banner / universal link
  return `https://bpa.link/cert/${certToken}`;
}
```

### 6.2 Flutter Deep Link Handler

```dart
// lib/router/deep_link_handler.dart

class DeepLinkHandler {
  void handleDeepLink(Uri uri) {
    if (uri.pathSegments.first == 'certificate') {
      final token = uri.pathSegments[1];
      _handleCertificateLink(token);
    }
  }
  
  Future<void> _handleCertificateLink(String token) async {
    // Check if user is logged in
    final user = ref.read(authProvider).user;
    
    if (user == null) {
      // Store token for after login
      ref.read(pendingCertificateLinkProvider.notifier).state = token;
      // Navigate to login
      context.go('/auth/login?redirect=certificate');
      return;
    }
    
    // Verify and link certificate
    try {
      final result = await ref.read(certificateServiceProvider)
          .claimCertificate(token);
      
      if (result.success) {
        // Show success and navigate to pet/vaccination details
        context.go('/pets/${result.petId}/vaccinations');
      }
    } catch (e) {
      // Show error
    }
  }
}
```

---

## 7. API Endpoints

### 7.1 Linking APIs

```typescript
// POST /api/v1/campaign-link/check
// Check if phone has unlinked campaign records
router.post('/campaign-link/check',
  authenticate,
  async (req, res) => {
    const { phone } = req.body;
    
    const unlinked = await prisma.campaignBooking.count({
      where: {
        ownerPhone: phone,
        userId: null,
      },
    });
    
    res.json({ hasUnlinkedRecords: unlinked > 0, count: unlinked });
  }
);

// POST /api/v1/campaign-link/import
// Import campaign records to user account
router.post('/campaign-link/import',
  authenticate,
  async (req, res) => {
    const userId = req.user.id;
    const phone = req.user.phone;
    
    const result = await linkCampaignRecordsToNewUser(userId, phone);
    
    res.json(result);
  }
);

// POST /api/v1/campaign-link/pet/:campaignPetId
// Link campaign pet to existing BPA pet
router.post('/campaign-link/pet/:campaignPetId',
  authenticate,
  async (req, res) => {
    const { campaignPetId } = req.params;
    const { existingPetId } = req.body;
    const userId = req.user.id;
    
    await linkExistingPet(parseInt(campaignPetId), existingPetId, userId);
    
    res.json({ success: true });
  }
);

// POST /api/v1/campaign-link/certificate/:token/claim
// Claim certificate and link to account
router.post('/campaign-link/certificate/:token/claim',
  authenticate,
  async (req, res) => {
    const { token } = req.params;
    const userId = req.user.id;
    
    const result = await claimCertificate(token, userId);
    
    res.json(result);
  }
);
```

---

## 8. Data Migration Considerations

### 8.1 Bulk Linking (Post-Campaign)

```typescript
// Script to run after campaign ends to link remaining records
async function bulkLinkByPhone(): Promise<BulkLinkReport> {
  const unlinkedBookings = await prisma.campaignBooking.findMany({
    where: { userId: null },
    select: { id: true, ownerPhone: true },
  });
  
  const report = {
    total: unlinkedBookings.length,
    linked: 0,
    notFound: 0,
    errors: [] as string[],
  };
  
  for (const booking of unlinkedBookings) {
    const user = await prisma.user.findFirst({
      where: { auth: { phone: booking.ownerPhone } },
    });
    
    if (!user) {
      report.notFound++;
      continue;
    }
    
    try {
      await prisma.campaignBooking.update({
        where: { id: booking.id },
        data: {
          userId: user.id,
          linkSource: 'MANUAL_LINK',
          linkedAt: new Date(),
        },
      });
      report.linked++;
    } catch (e) {
      report.errors.push(`Booking ${booking.id}: ${e}`);
    }
  }
  
  return report;
}
```

### 8.2 Verification Reports

```typescript
// Verify data integrity after linking
async function verifyLinkingIntegrity(): Promise<IntegrityReport> {
  // Check for orphaned vaccinations
  const orphanedVaccinations = await prisma.vaccination.count({
    where: {
      campaignPetId: { not: null },
      petId: null,
    },
  });
  
  // Check for mismatched phone numbers
  const mismatchedPhones = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT cb.id
    FROM campaign_bookings cb
    JOIN users u ON cb.user_id = u.id
    JOIN user_auths ua ON u.auth_id = ua.id
    WHERE ua.phone != cb.owner_phone
  `;
  
  return {
    orphanedVaccinations,
    mismatchedPhones: mismatchedPhones.length,
    healthy: orphanedVaccinations === 0 && mismatchedPhones.length === 0,
  };
}
```
