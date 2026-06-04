# Staff Portal Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

The Staff Portal is a mobile-optimized web application for campaign staff to:
- Check-in attendees via QR scan or phone lookup
- Register walk-in participants
- Record vaccinations
- Manage the vaccination queue

---

## 2. Portal Structure

### 2.1 Navigation

```
Staff Portal (Mobile-First)
├── Dashboard
│   ├── Today's Stats
│   └── Quick Actions
├── Check-in
│   ├── QR Scan
│   ├── Phone Search
│   └── Booking Details
├── Walk-in
│   └── Registration Form
├── Queue
│   ├── Current Queue
│   └── Call Next
├── Vaccinate
│   ├── Pet Selection
│   ├── Pre-Check Form
│   └── Vaccination Form
└── History
    └── Today's Records
```

### 2.2 Access Control

| Role | Check-in | Walk-in | Vaccinate | Queue Mgmt |
|------|----------|---------|-----------|------------|
| CHECK_IN | ✓ | ✓ | ✗ | View |
| VACCINATOR | ✓ | ✓ | ✓ | ✓ |
| COORDINATOR | ✓ | ✓ | ✓ | ✓ |
| ADMIN | ✓ | ✓ | ✓ | ✓ |

---

## 3. Page Designs

### 3.1 Staff Dashboard

```
┌─────────────────────────────────────────┐
│ ≡  Vaccination Campaign Staff           │
│     Dhaka Central Vet Clinic            │
├─────────────────────────────────────────┤
│                                         │
│   TODAY: July 15, 2026                  │
│   ─────────────────────────────────     │
│                                         │
│   ┌─────────┐  ┌─────────┐              │
│   │   45    │  │   38    │              │
│   │ Booked  │  │ Done    │              │
│   └─────────┘  └─────────┘              │
│                                         │
│   ┌─────────┐  ┌─────────┐              │
│   │   12    │  │    5    │              │
│   │ Waiting │  │ No-show │              │
│   └─────────┘  └─────────┘              │
│                                         │
│   ─────────────────────────────────     │
│   QUICK ACTIONS                         │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ 📷  Scan QR to Check-in       │     │
│   └───────────────────────────────┘     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ 🔍  Search by Phone           │     │
│   └───────────────────────────────┘     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ ➕  Register Walk-in          │     │
│   └───────────────────────────────┘     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ 📋  View Queue (12 waiting)   │     │
│   └───────────────────────────────┘     │
│                                         │
├─────────────────────────────────────────┤
│ 🏠     📷     ➕     📋     💉         │
│ Home   Scan   New   Queue  Vacc         │
└─────────────────────────────────────────┘
```

### 3.2 QR Scanner Page

```
┌─────────────────────────────────────────┐
│ ←  Scan QR Code                         │
├─────────────────────────────────────────┤
│                                         │
│   ┌───────────────────────────────┐     │
│   │                               │     │
│   │                               │     │
│   │      ┌─────────────────┐      │     │
│   │      │                 │      │     │
│   │      │   [ CAMERA ]    │      │     │
│   │      │   [ VIEWFINDER ]│      │     │
│   │      │                 │      │     │
│   │      └─────────────────┘      │     │
│   │                               │     │
│   │                               │     │
│   └───────────────────────────────┘     │
│                                         │
│   Point camera at the QR code on        │
│   the booking confirmation              │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   Can't scan?                           │
│   ┌───────────────────────────────┐     │
│   │ 🔍  Search by Phone Number    │     │
│   └───────────────────────────────┘     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ #️⃣  Enter Booking Reference   │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### 3.3 Booking Details (After Scan)

```
┌─────────────────────────────────────────┐
│ ←  Booking Details                      │
├─────────────────────────────────────────┤
│                                         │
│   ✓ VALID BOOKING                       │
│   VAC-ABC123                            │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   OWNER                                 │
│   John Doe                              │
│   📞 01712345678                        │
│                                         │
│   APPOINTMENT                           │
│   📅 Today, 09:00 - 12:00               │
│   📍 Dhaka Central Vet Clinic           │
│                                         │
│   PETS (2)                              │
│   ┌───────────────────────────────┐     │
│   │ 🐱 Mittens                    │     │
│   │    Female • 2 years           │     │
│   │    Status: ⏳ PENDING         │     │
│   └───────────────────────────────┘     │
│   ┌───────────────────────────────┐     │
│   │ 🐱 Whiskers                   │     │
│   │    Male • 1 year              │     │
│   │    Status: ⏳ PENDING         │     │
│   └───────────────────────────────┘     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │       ✓  CHECK IN             │     │
│   │    Assign queue number        │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### 3.4 Check-in Confirmation

```
┌─────────────────────────────────────────┐
│ ←  Check-in Complete                    │
├─────────────────────────────────────────┤
│                                         │
│                                         │
│            ┌─────────┐                  │
│            │  ✓ ✓ ✓  │                  │
│            └─────────┘                  │
│                                         │
│         CHECKED IN!                     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│         QUEUE NUMBER                    │
│                                         │
│         ┌─────────────┐                 │
│         │             │                 │
│         │    A042     │                 │
│         │             │                 │
│         └─────────────┘                 │
│                                         │
│   Estimated wait: ~15 minutes           │
│   Current serving: A038                 │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │    🖨️  Print Queue Ticket     │     │
│   └───────────────────────────────┘     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │    📷  Scan Next QR           │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### 3.5 Walk-in Registration

```
┌─────────────────────────────────────────┐
│ ←  Walk-in Registration                 │
├─────────────────────────────────────────┤
│                                         │
│   Walk-in capacity: 8 remaining         │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   OWNER INFORMATION                     │
│                                         │
│   Phone Number *                        │
│   ┌───────────────────────────────┐     │
│   │ 01712345678                   │     │
│   └───────────────────────────────┘     │
│                                         │
│   Name *                                │
│   ┌───────────────────────────────┐     │
│   │ John Doe                      │     │
│   └───────────────────────────────┘     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   PET INFORMATION                       │
│                                         │
│   Pet 1                                 │
│   ┌───────────────────────────────┐     │
│   │ Name: Mittens                 │     │
│   │ Gender: [Female ▾]            │     │
│   │ Age: 2 years                  │     │
│   └───────────────────────────────┘     │
│                                         │
│   [+ Add another pet]                   │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │    REGISTER WALK-IN           │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### 3.6 Queue Management

```
┌─────────────────────────────────────────┐
│ ←  Vaccination Queue                    │
├─────────────────────────────────────────┤
│                                         │
│   NOW SERVING                           │
│   ┌───────────────────────────────┐     │
│   │         A038                  │     │
│   │   John Doe • 2 cats           │     │
│   │   [View] [Complete]           │     │
│   └───────────────────────────────┘     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   WAITING (12)                          │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ A039  Jane Smith     1 cat    │     │
│   │       Waiting 5 min     [Call]│     │
│   └───────────────────────────────┘     │
│   ┌───────────────────────────────┐     │
│   │ A040  Ahmed Khan     2 cats   │     │
│   │       Waiting 3 min     [Call]│     │
│   └───────────────────────────────┘     │
│   ┌───────────────────────────────┐     │
│   │ W012  Fatima Begum   1 cat    │     │
│   │       Walk-in, 8 min    [Call]│     │
│   └───────────────────────────────┘     │
│                                         │
│   ... 9 more                            │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │    📣  CALL NEXT              │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### 3.7 Vaccination Recording

```
┌─────────────────────────────────────────┐
│ ←  Record Vaccination                   │
├─────────────────────────────────────────┤
│                                         │
│   BOOKING: VAC-ABC123                   │
│   Owner: John Doe                       │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   SELECT PET                            │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ ⚪ Mittens       ⏳ Pending   │     │
│   └───────────────────────────────┘     │
│   ┌───────────────────────────────┐     │
│   │ ⚪ Whiskers      ⏳ Pending   │     │
│   └───────────────────────────────┘     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   PRE-VACCINATION CHECK                 │
│                                         │
│   ☑️ Cat appears healthy                │
│   ☑️ No recent illness reported         │
│   ☑️ Not currently on medication        │
│   ☑️ Not pregnant (if female)           │
│   ☑️ Appropriate age for vaccine        │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   VACCINE DETAILS                       │
│                                         │
│   Vaccine Type *                        │
│   ┌───────────────────────────────┐     │
│   │ Rabies                    ▾   │     │
│   └───────────────────────────────┘     │
│                                         │
│   Batch Number *                        │
│   ┌───────────────────────────────┐     │
│   │ RAB-2026-001                  │     │
│   └───────────────────────────────┘     │
│                                         │
│   Expiry Date *                         │
│   ┌───────────────────────────────┐     │
│   │ 2027-06-30               📅   │     │
│   └───────────────────────────────┘     │
│                                         │
│   Notes (optional)                      │
│   ┌───────────────────────────────┐     │
│   │                               │     │
│   └───────────────────────────────┘     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │  💉  RECORD VACCINATION       │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### 3.8 Vaccination Success

```
┌─────────────────────────────────────────┐
│      Vaccination Recorded               │
├─────────────────────────────────────────┤
│                                         │
│                                         │
│            ┌─────────┐                  │
│            │   💉    │                  │
│            │   ✓     │                  │
│            └─────────┘                  │
│                                         │
│        VACCINATION COMPLETE             │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   Pet: Mittens                          │
│   Vaccine: Rabies                       │
│   Batch: RAB-2026-001                   │
│                                         │
│   Certificate: CERT-XYZ789012345        │
│   SMS sent to owner ✓                   │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   REMAINING PETS                        │
│                                         │
│   ┌───────────────────────────────┐     │
│   │ 🐱 Whiskers      ⏳ Pending   │     │
│   │ [Vaccinate Now]               │     │
│   └───────────────────────────────┘     │
│                                         │
│   ─────────────────────────────────     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │  🖨️  Print Certificate        │     │
│   └───────────────────────────────┘     │
│                                         │
│   ┌───────────────────────────────┐     │
│   │  📋  Back to Queue            │     │
│   └───────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

---

## 4. Component Implementation

### 4.1 QR Scanner Component

```tsx
// components/staff/QrScanner.tsx

import { useCallback, useState } from 'react';
import { QrReader } from 'react-qr-reader';
import { useRouter } from 'next/router';

export function QrScanner() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  
  const handleScan = useCallback(async (result: string | null) => {
    if (!result || processing) return;
    
    setProcessing(true);
    
    try {
      // Extract QR token from URL or direct token
      let qrToken: string;
      
      try {
        const url = new URL(result);
        const match = url.pathname.match(/\/c\/([a-f0-9]{32})/i);
        if (match) {
          qrToken = match[1];
        } else {
          throw new Error('Invalid QR URL');
        }
      } catch {
        // Direct token
        if (/^[a-f0-9]{32}$/i.test(result)) {
          qrToken = result;
        } else {
          throw new Error('Invalid QR code');
        }
      }
      
      // Navigate to booking details
      router.push(`/staff/check-in/${qrToken}`);
    } catch (err) {
      setError('Invalid QR code. Please try again.');
      setProcessing(false);
      
      // Reset error after 3 seconds
      setTimeout(() => setError(null), 3000);
    }
  }, [processing, router]);
  
  return (
    <div className="flex flex-col h-full">
      {/* Scanner */}
      <div className="flex-1 relative bg-black">
        <QrReader
          constraints={{ facingMode: 'environment' }}
          onResult={(result) => {
            if (result) {
              handleScan(result.getText());
            }
          }}
          scanDelay={300}
          videoContainerStyle={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
          }}
        />
        
        {/* Overlay with viewfinder */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-64 h-64 border-2 border-white rounded-lg">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-green-400 rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-green-400 rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-green-400 rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-green-400 rounded-br-lg" />
          </div>
        </div>
        
        {/* Error message */}
        {error && (
          <div className="absolute bottom-4 left-4 right-4 bg-red-500 text-white p-3 rounded-lg text-center">
            {error}
          </div>
        )}
        
        {/* Processing indicator */}
        {processing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="bg-white p-4 rounded-lg">
              <Spinner />
              <p className="mt-2">Looking up booking...</p>
            </div>
          </div>
        )}
      </div>
      
      {/* Alternative options */}
      <div className="p-4 bg-white space-y-3">
        <p className="text-center text-gray-500 text-sm">
          Point camera at the QR code
        </p>
        
        <button
          onClick={() => router.push('/staff/search')}
          className="w-full py-3 border rounded-lg flex items-center justify-center gap-2"
        >
          <SearchIcon className="w-5 h-5" />
          Search by Phone Number
        </button>
        
        <button
          onClick={() => router.push('/staff/search?type=ref')}
          className="w-full py-3 border rounded-lg flex items-center justify-center gap-2"
        >
          <HashIcon className="w-5 h-5" />
          Enter Booking Reference
        </button>
      </div>
    </div>
  );
}
```

### 4.2 Vaccination Form

```tsx
// components/staff/VaccinationForm.tsx

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const vaccinationSchema = z.object({
  campaignPetId: z.number(),
  vaccineTypeId: z.number(),
  batchNumber: z.string().min(1, 'Batch number is required'),
  lotNumber: z.string().optional(),
  expiryDate: z.string().refine((date) => new Date(date) > new Date(), {
    message: 'Vaccine is expired',
  }),
  notes: z.string().max(500).optional(),
  preCheck: z.object({
    appearHealthy: z.boolean(),
    noRecentIllness: z.boolean(),
    notOnMedication: z.boolean(),
    notPregnant: z.boolean(),
    ageAppropriate: z.boolean(),
  }).refine((check) => Object.values(check).every(Boolean), {
    message: 'All pre-vaccination checks must pass',
  }),
});

type VaccinationFormData = z.infer<typeof vaccinationSchema>;

interface VaccinationFormProps {
  booking: CampaignBooking;
  pets: CampaignPet[];
  vaccineTypes: VaccineType[];
  onSubmit: (data: VaccinationFormData) => Promise<void>;
}

export function VaccinationForm({
  booking,
  pets,
  vaccineTypes,
  onSubmit,
}: VaccinationFormProps) {
  const pendingPets = pets.filter((p) => p.vaccinationStatus === 'PENDING');
  
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<VaccinationFormData>({
    resolver: zodResolver(vaccinationSchema),
    defaultValues: {
      campaignPetId: pendingPets[0]?.id,
      preCheck: {
        appearHealthy: false,
        noRecentIllness: false,
        notOnMedication: false,
        notPregnant: false,
        ageAppropriate: false,
      },
    },
  });
  
  const selectedPetId = watch('campaignPetId');
  const selectedPet = pets.find((p) => p.id === selectedPetId);
  
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 p-4">
      {/* Pet Selection */}
      <div>
        <label className="block text-sm font-medium mb-2">Select Pet</label>
        <div className="space-y-2">
          {pendingPets.map((pet) => (
            <label
              key={pet.id}
              className={`flex items-center p-3 border rounded-lg cursor-pointer ${
                selectedPetId === pet.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200'
              }`}
            >
              <input
                type="radio"
                {...register('campaignPetId', { valueAsNumber: true })}
                value={pet.id}
                className="mr-3"
              />
              <div>
                <p className="font-medium">{pet.name}</p>
                <p className="text-sm text-gray-500">
                  {pet.gender || 'Unknown'} • {pet.ageMonths ? `${Math.floor(pet.ageMonths / 12)} years` : 'Age unknown'}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>
      
      {/* Pre-vaccination Check */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Pre-vaccination Check
        </label>
        <div className="space-y-2 bg-gray-50 p-4 rounded-lg">
          {[
            { key: 'appearHealthy', label: 'Cat appears healthy' },
            { key: 'noRecentIllness', label: 'No recent illness reported' },
            { key: 'notOnMedication', label: 'Not currently on medication' },
            { key: 'notPregnant', label: 'Not pregnant (if female)' },
            { key: 'ageAppropriate', label: 'Appropriate age for vaccine' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center">
              <input
                type="checkbox"
                {...register(`preCheck.${key as keyof VaccinationFormData['preCheck']}`)}
                className="mr-3 w-5 h-5 rounded"
              />
              {label}
            </label>
          ))}
        </div>
        {errors.preCheck && (
          <p className="text-red-500 text-sm mt-1">
            All checks must pass before vaccination
          </p>
        )}
      </div>
      
      {/* Vaccine Type */}
      <div>
        <label className="block text-sm font-medium mb-2">Vaccine Type</label>
        <select
          {...register('vaccineTypeId', { valueAsNumber: true })}
          className="w-full p-3 border rounded-lg"
        >
          {vaccineTypes.map((vt) => (
            <option key={vt.id} value={vt.id}>
              {vt.name}
            </option>
          ))}
        </select>
      </div>
      
      {/* Batch Number */}
      <div>
        <label className="block text-sm font-medium mb-2">Batch Number</label>
        <input
          {...register('batchNumber')}
          className="w-full p-3 border rounded-lg"
          placeholder="e.g., RAB-2026-001"
        />
        {errors.batchNumber && (
          <p className="text-red-500 text-sm mt-1">{errors.batchNumber.message}</p>
        )}
      </div>
      
      {/* Expiry Date */}
      <div>
        <label className="block text-sm font-medium mb-2">Expiry Date</label>
        <input
          type="date"
          {...register('expiryDate')}
          className="w-full p-3 border rounded-lg"
        />
        {errors.expiryDate && (
          <p className="text-red-500 text-sm mt-1">{errors.expiryDate.message}</p>
        )}
      </div>
      
      {/* Notes */}
      <div>
        <label className="block text-sm font-medium mb-2">Notes (optional)</label>
        <textarea
          {...register('notes')}
          className="w-full p-3 border rounded-lg"
          rows={3}
          placeholder="Any observations or notes..."
        />
      </div>
      
      {/* Submit */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-4 bg-green-600 text-white rounded-lg font-medium disabled:opacity-50"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner className="w-5 h-5" />
            Recording...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <SyringeIcon className="w-5 h-5" />
            Record Vaccination
          </span>
        )}
      </button>
    </form>
  );
}
```

---

## 5. Offline Support

### 5.1 Service Worker Registration

```typescript
// sw.ts
const CACHE_NAME = 'bpa-staff-v1';
const OFFLINE_URLS = [
  '/staff/',
  '/staff/scan',
  '/staff/walk-in',
  '/staff/queue',
];

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_URLS);
    })
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  // Handle API requests with background sync
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Queue for later sync if offline
        return new Response(
          JSON.stringify({ offline: true, queued: true }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
  }
});
```

### 5.2 Offline Queue

```typescript
// lib/offlineQueue.ts
import { openDB, DBSchema } from 'idb';

interface OfflineAction {
  id: string;
  type: 'CHECK_IN' | 'VACCINATION';
  data: Record<string, unknown>;
  timestamp: Date;
  synced: boolean;
}

const dbPromise = openDB<{ actions: OfflineAction }>('bpa-staff-offline', 1, {
  upgrade(db) {
    db.createObjectStore('actions', { keyPath: 'id' });
  },
});

export async function queueOfflineAction(action: Omit<OfflineAction, 'id' | 'synced'>) {
  const db = await dbPromise;
  const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  await db.put('actions', {
    ...action,
    id,
    synced: false,
  });
  
  return id;
}

export async function syncOfflineActions() {
  const db = await dbPromise;
  const actions = await db.getAll('actions');
  const pendingActions = actions.filter((a) => !a.synced);
  
  for (const action of pendingActions) {
    try {
      await syncAction(action);
      await db.put('actions', { ...action, synced: true });
    } catch (error) {
      console.error('Failed to sync action:', action.id, error);
    }
  }
}

// Listen for online event to trigger sync
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncOfflineActions();
  });
}
```

---

## 6. Staff Authentication

### 6.1 Login Flow

```tsx
// pages/staff/login.tsx

export default function StaffLoginPage() {
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/auth/staff-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      
      if (!response.ok) {
        throw new Error('Invalid credentials');
      }
      
      const { token, staff } = await response.json();
      
      // Store token
      localStorage.setItem('staffToken', token);
      
      // Check campaign assignment
      if (!staff.campaignAssignments?.length) {
        router.push('/staff/no-campaign');
        return;
      }
      
      // If multiple campaigns, let them choose
      if (staff.campaignAssignments.length > 1) {
        router.push('/staff/select-campaign');
      } else {
        router.push('/staff/dashboard');
      }
    } catch (err) {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  }
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-xl font-bold text-center mb-6">
          Staff Portal Login
        </h1>
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={credentials.email}
              onChange={(e) => setCredentials({ ...credentials, email: e.target.value })}
              className="w-full p-3 border rounded-lg"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
              className="w-full p-3 border rounded-lg"
              required
            />
          </div>
          
          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}
          
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
```
