# Vaccination Workflow Design

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

This document details the end-to-end vaccination workflow from check-in to certificate generation.

---

## 2. Workflow Stages

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       VACCINATION WORKFLOW STAGES                            │
└─────────────────────────────────────────────────────────────────────────────┘

[ARRIVAL] ──► [CHECK-IN] ──► [QUEUE] ──► [PRE-CHECK] ──► [VACCINATION] ──► [CERTIFICATE]
    │              │            │            │                │                 │
    │              │            │            │                │                 │
    ▼              ▼            ▼            ▼                ▼                 ▼
 Walk-in        Verify       Assign       Health          Record            Generate
    or          Booking      Queue#       Check          Vaccine              PDF
 Scheduled       QR                       Form            Data
```

---

## 3. Stage 1: Arrival & Check-in

### 3.1 Scheduled Booking Check-in

```typescript
interface CheckInRequest {
  qrToken?: string;
  phone?: string;
  bookingRef?: string;
  locationId: number;
}

async function checkInBooking(req: CheckInRequest, staffUserId: number) {
  // 1. Find booking
  let booking: CampaignBooking | null = null;
  
  if (req.qrToken) {
    booking = await findByQrToken(req.qrToken);
  } else if (req.phone) {
    booking = await findByPhoneForToday(req.phone, req.locationId);
  } else if (req.bookingRef) {
    booking = await findByRef(req.bookingRef);
  }
  
  if (!booking) {
    throw new ApiError('BOOKING_NOT_FOUND', 404);
  }
  
  // 2. Validate
  const validation = validateCheckIn(booking, req.locationId);
  if (!validation.canProceed) {
    return { booking, validation, checkedIn: false };
  }
  
  // 3. Check-in
  const queueNumber = await generateQueueNumber(
    req.locationId,
    booking.bookingDate,
    false // not walk-in
  );
  
  const updatedBooking = await prisma.campaignBooking.update({
    where: { id: booking.id },
    data: {
      status: 'CHECKED_IN',
      checkedInAt: new Date(),
      checkedInByUserId: staffUserId,
      queueNumber,
    },
    include: {
      pets: true,
      location: true,
    },
  });
  
  // 4. Audit log
  await logAudit({
    campaignId: booking.campaignId,
    action: 'BOOKING_CHECKED_IN',
    entityType: 'BOOKING',
    entityId: booking.id,
    actorUserId: staffUserId,
  });
  
  return {
    booking: updatedBooking,
    validation: { canProceed: true },
    checkedIn: true,
    queueNumber,
  };
}

function validateCheckIn(booking: CampaignBooking, locationId: number) {
  const warnings: string[] = [];
  let canProceed = true;
  
  // Status check
  if (booking.status === 'CHECKED_IN') {
    return {
      canProceed: true,
      isAlreadyCheckedIn: true,
      queueNumber: booking.queueNumber,
    };
  }
  
  if (booking.status === 'COMPLETED') {
    return {
      canProceed: false,
      reason: 'Booking already completed',
    };
  }
  
  if (booking.status === 'CANCELLED') {
    return {
      canProceed: false,
      reason: 'Booking was cancelled',
    };
  }
  
  // Location check
  if (booking.locationId !== locationId) {
    warnings.push(`Booking is for different location: ${booking.location.name}`);
    // Allow with warning (accommodation)
  }
  
  // Date check
  const today = startOfDay(new Date());
  const bookingDate = startOfDay(booking.bookingDate);
  
  if (!isSameDay(today, bookingDate)) {
    if (isBefore(today, bookingDate)) {
      warnings.push(`Booking is for future date: ${format(bookingDate, 'MMM d')}`);
    } else {
      warnings.push(`Booking was for past date: ${format(bookingDate, 'MMM d')}`);
    }
    // Allow with warning
  }
  
  return { canProceed, warnings };
}
```

### 3.2 Walk-in Registration

```typescript
interface WalkInRequest {
  campaignId: number;
  locationId: number;
  owner: {
    phone: string;
    name: string;
    address?: AddressJson;
  };
  pets: Array<{
    name: string;
    gender?: 'MALE' | 'FEMALE';
    ageMonths?: number;
    breedId?: number;
    colorDescription?: string;
  }>;
}

async function registerWalkIn(req: WalkInRequest, staffUserId: number) {
  // 1. Check walk-in capacity
  const capacity = await checkWalkInCapacity(req.locationId);
  if (!capacity.available) {
    throw new ApiError('WALK_IN_FULL', 'No walk-in capacity available', 409);
  }
  
  // 2. Check existing booking for phone today
  const existingBooking = await prisma.campaignBooking.findFirst({
    where: {
      campaignId: req.campaignId,
      ownerPhone: req.owner.phone,
      bookingDate: startOfDay(new Date()),
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    },
  });
  
  if (existingBooking) {
    // Return existing booking for check-in
    return {
      type: 'EXISTING_BOOKING',
      booking: existingBooking,
    };
  }
  
  // 3. Find or create user
  const user = await findOrCreateCampaignUser(req.owner.phone, req.owner.name);
  
  // 4. Create booking
  const bookingRef = await createUniqueBookingRef();
  const qrToken = generateQrToken();
  const queueNumber = await generateQueueNumber(req.locationId, new Date(), true);
  
  const booking = await prisma.campaignBooking.create({
    data: {
      campaignId: req.campaignId,
      locationId: req.locationId,
      slotId: await getWalkInSlotId(req.locationId), // Special walk-in slot
      bookingRef,
      qrToken,
      ownerUserId: user?.id,
      ownerPhone: req.owner.phone,
      ownerName: req.owner.name,
      ownerAddressJson: req.owner.address,
      bookingDate: startOfDay(new Date()),
      petCount: req.pets.length,
      status: 'CHECKED_IN', // Already checked in
      isWalkIn: true,
      checkedInAt: new Date(),
      checkedInByUserId: staffUserId,
      queueNumber,
      paymentStatus: 'NOT_REQUIRED', // Campaign is free
      pets: {
        create: req.pets.map(pet => ({
          name: pet.name,
          animalTypeId: 2, // Cat
          breedId: pet.breedId,
          gender: pet.gender,
          ageMonths: pet.ageMonths,
          colorDescription: pet.colorDescription,
          vaccinationStatus: 'PENDING',
        })),
      },
    },
    include: {
      pets: true,
      location: true,
    },
  });
  
  // 5. Update walk-in counter
  await incrementWalkInCount(req.locationId);
  
  // 6. Send SMS
  await sendCampaignSms({
    campaignId: req.campaignId,
    bookingId: booking.id,
    phone: req.owner.phone,
    templateCode: 'BOOKING_CONFIRMED',
    variables: {
      bookingRef: booking.bookingRef,
      date: format(new Date(), 'dd MMM yyyy'),
      slot: 'Walk-in',
      location: booking.location.name,
      petNames: req.pets.map(p => p.name).join(', '),
      qrUrl: `https://vacc.bpa.com.bd/c/${qrToken}`,
    },
  });
  
  return {
    type: 'NEW_WALK_IN',
    booking,
    queueNumber,
  };
}

async function checkWalkInCapacity(locationId: number) {
  const location = await prisma.campaignLocation.findUnique({
    where: { id: locationId },
    include: { campaign: true },
  });
  
  const walkInQuota = Math.floor(
    location.dailyCapacity * (location.campaign.walkInQuotaPercent / 100)
  );
  
  const todayWalkIns = await prisma.campaignBooking.count({
    where: {
      locationId,
      isWalkIn: true,
      bookingDate: startOfDay(new Date()),
      status: { notIn: ['CANCELLED'] },
    },
  });
  
  return {
    available: todayWalkIns < walkInQuota,
    used: todayWalkIns,
    quota: walkInQuota,
    remaining: walkInQuota - todayWalkIns,
  };
}
```

---

## 4. Stage 2: Queue Management

### 4.1 Queue Display

```typescript
interface QueueState {
  locationId: number;
  current: {
    appointment: string | null; // A###
    walkIn: string | null;      // W###
  };
  waiting: {
    appointments: QueueItem[];
    walkIns: QueueItem[];
  };
  stats: {
    checkedIn: number;
    inProgress: number;
    completed: number;
    remaining: number;
  };
}

interface QueueItem {
  queueNumber: string;
  bookingRef: string;
  ownerName: string;
  petCount: number;
  waitTime: number; // minutes
}

async function getQueueState(locationId: number): Promise<QueueState> {
  const today = startOfDay(new Date());
  
  // Get all checked-in bookings
  const checkedIn = await prisma.campaignBooking.findMany({
    where: {
      locationId,
      bookingDate: today,
      status: 'CHECKED_IN',
    },
    orderBy: { checkedInAt: 'asc' },
    select: {
      id: true,
      bookingRef: true,
      queueNumber: true,
      ownerName: true,
      petCount: true,
      isWalkIn: true,
      checkedInAt: true,
    },
  });
  
  // Get in-progress
  const inProgress = await prisma.campaignBooking.findMany({
    where: {
      locationId,
      bookingDate: today,
      status: 'IN_PROGRESS',
    },
    select: {
      queueNumber: true,
      isWalkIn: true,
    },
  });
  
  // Get completed count
  const completedCount = await prisma.campaignBooking.count({
    where: {
      locationId,
      bookingDate: today,
      status: 'COMPLETED',
    },
  });
  
  // Separate appointments and walk-ins
  const appointments = checkedIn.filter(b => !b.isWalkIn);
  const walkIns = checkedIn.filter(b => b.isWalkIn);
  
  const currentAppointment = inProgress.find(b => !b.isWalkIn);
  const currentWalkIn = inProgress.find(b => b.isWalkIn);
  
  return {
    locationId,
    current: {
      appointment: currentAppointment?.queueNumber || appointments[0]?.queueNumber || null,
      walkIn: currentWalkIn?.queueNumber || walkIns[0]?.queueNumber || null,
    },
    waiting: {
      appointments: appointments.map(b => ({
        queueNumber: b.queueNumber,
        bookingRef: b.bookingRef,
        ownerName: b.ownerName,
        petCount: b.petCount,
        waitTime: Math.round((Date.now() - b.checkedInAt.getTime()) / 60000),
      })),
      walkIns: walkIns.map(b => ({
        queueNumber: b.queueNumber,
        bookingRef: b.bookingRef,
        ownerName: b.ownerName,
        petCount: b.petCount,
        waitTime: Math.round((Date.now() - b.checkedInAt.getTime()) / 60000),
      })),
    },
    stats: {
      checkedIn: checkedIn.length,
      inProgress: inProgress.length,
      completed: completedCount,
      remaining: checkedIn.length,
    },
  };
}
```

### 4.2 Call Next

```typescript
async function callNextInQueue(
  locationId: number,
  preferWalkIn: boolean = false
): Promise<CampaignBooking | null> {
  const today = startOfDay(new Date());
  
  // Priority: Appointments first, unless preferWalkIn
  const orderByWalkIn = preferWalkIn ? 'desc' : 'asc';
  
  const next = await prisma.campaignBooking.findFirst({
    where: {
      locationId,
      bookingDate: today,
      status: 'CHECKED_IN',
    },
    orderBy: [
      { isWalkIn: orderByWalkIn },
      { checkedInAt: 'asc' },
    ],
    include: {
      pets: true,
    },
  });
  
  if (!next) {
    return null;
  }
  
  // Update to IN_PROGRESS
  const updated = await prisma.campaignBooking.update({
    where: { id: next.id },
    data: { status: 'IN_PROGRESS' },
    include: { pets: true },
  });
  
  return updated;
}
```

---

## 5. Stage 3: Pre-Vaccination Check

### 5.1 Health Check Form

```typescript
interface PreVaccinationCheck {
  petId: number;
  questions: {
    appearHealthy: boolean;
    noRecentIllness: boolean;
    notOnMedication: boolean;
    notPregnant: boolean;
    ageAppropriate: boolean;
  };
  notes?: string;
  passed: boolean;
}

function evaluatePreCheck(check: Omit<PreVaccinationCheck, 'passed'>): PreVaccinationCheck {
  const { questions } = check;
  
  // All must be true for pass (except notes which should indicate no issues)
  const passed = 
    questions.appearHealthy &&
    questions.noRecentIllness &&
    questions.notOnMedication &&
    questions.notPregnant &&
    questions.ageAppropriate;
  
  return { ...check, passed };
}
```

### 5.2 Handle Pre-Check Failure

```typescript
interface DeferralRequest {
  bookingId: number;
  campaignPetId: number;
  reason: string;
  recommendedFollowUp?: string;
}

async function deferPetVaccination(req: DeferralRequest, staffUserId: number) {
  await prisma.campaignPet.update({
    where: { id: req.campaignPetId },
    data: {
      vaccinationStatus: 'DEFERRED',
    },
  });
  
  await logAudit({
    campaignId: booking.campaignId,
    action: 'PET_DEFERRED',
    entityType: 'CAMPAIGN_PET',
    entityId: req.campaignPetId,
    actorUserId: staffUserId,
    metadataJson: {
      reason: req.reason,
      recommendedFollowUp: req.recommendedFollowUp,
    },
  });
  
  return { deferred: true };
}
```

---

## 6. Stage 4: Vaccination Recording

### 6.1 Record Vaccination

```typescript
interface RecordVaccinationRequest {
  bookingId: number;
  campaignPetId: number;
  vaccineTypeId: number;
  batchNumber: string;
  lotNumber?: string;
  expiryDate: string;
  notes?: string;
}

async function recordVaccination(
  req: RecordVaccinationRequest,
  staffUserId: number
) {
  // 1. Get booking and pet
  const [booking, campaignPet] = await Promise.all([
    prisma.campaignBooking.findUnique({
      where: { id: req.bookingId },
      include: { campaign: true },
    }),
    prisma.campaignPet.findUnique({
      where: { id: req.campaignPetId },
    }),
  ]);
  
  if (!booking || !campaignPet) {
    throw new ApiError('NOT_FOUND', 404);
  }
  
  if (campaignPet.vaccinationStatus === 'COMPLETED') {
    throw new ApiError('ALREADY_VACCINATED', 'Pet already vaccinated', 409);
  }
  
  // 2. Get vaccine type
  const vaccineType = await prisma.vaccineType.findUnique({
    where: { id: req.vaccineTypeId },
  });
  
  if (!vaccineType) {
    throw new ApiError('INVALID_VACCINE_TYPE', 400);
  }
  
  // 3. Find or create permanent pet record
  let permanentPetId = campaignPet.permanentPetId;
  
  if (!permanentPetId) {
    // Create permanent pet record
    const permanentPet = await prisma.pet.create({
      data: {
        userId: booking.ownerUserId!, // Link to owner
        animalTypeId: campaignPet.animalTypeId,
        breedId: campaignPet.breedId,
        name: campaignPet.name,
        gender: campaignPet.gender,
        // Calculate DOB from age
        dateOfBirth: campaignPet.ageMonths
          ? subMonths(new Date(), campaignPet.ageMonths)
          : null,
      },
    });
    permanentPetId = permanentPet.id;
    
    // Update campaign pet with permanent ID
    await prisma.campaignPet.update({
      where: { id: campaignPet.id },
      data: { permanentPetId },
    });
  }
  
  // 4. Create vaccination record
  const certificateToken = generateCertificateToken();
  const nextDueDate = addDays(new Date(), vaccineType.defaultIntervalDays);
  
  const vaccination = await prisma.vaccination.create({
    data: {
      petId: permanentPetId,
      vaccineTypeId: req.vaccineTypeId,
      campaignBookingId: req.bookingId,
      administeredAt: new Date(),
      nextDueDate,
      batchNumber: req.batchNumber,
      manufacturer: null, // Could be derived from batch
      certificateToken,
      notes: req.notes,
      status: 'ACTIVE',
      createdByUserId: staffUserId,
      administeredByUserId: staffUserId,
    },
    include: {
      vaccineType: true,
      pet: true,
    },
  });
  
  // 5. Update campaign pet status
  await prisma.campaignPet.update({
    where: { id: campaignPet.id },
    data: {
      vaccinationStatus: 'COMPLETED',
      vaccinationId: vaccination.id,
    },
  });
  
  // 6. Check if all pets are done
  const remainingPets = await prisma.campaignPet.count({
    where: {
      bookingId: req.bookingId,
      vaccinationStatus: { in: ['PENDING', 'IN_PROGRESS'] },
    },
  });
  
  if (remainingPets === 0) {
    // All pets vaccinated - complete booking
    await prisma.campaignBooking.update({
      where: { id: req.bookingId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }
  
  // 7. Send certificate SMS
  await sendCampaignSms({
    campaignId: booking.campaignId,
    bookingId: booking.id,
    phone: booking.ownerPhone,
    templateCode: 'VACCINATION_COMPLETE',
    variables: {
      petName: campaignPet.name,
      vaccineName: vaccineType.name,
      certificateUrl: `https://vacc.bpa.com.bd/verify/${certificateToken}`,
      nextDueDate: format(nextDueDate, 'dd MMM yyyy'),
    },
  });
  
  // 8. Audit log
  await logAudit({
    campaignId: booking.campaignId,
    action: 'VACCINATION_RECORDED',
    entityType: 'VACCINATION',
    entityId: vaccination.id,
    actorUserId: staffUserId,
    metadataJson: {
      petId: permanentPetId,
      vaccineTypeId: req.vaccineTypeId,
      batchNumber: req.batchNumber,
    },
  });
  
  return {
    vaccination,
    certificate: {
      token: certificateToken,
      url: `https://vacc.bpa.com.bd/verify/${certificateToken}`,
      pdfUrl: `https://api.bpa.com.bd/api/v1/campaign-certificate/${certificateToken}/pdf`,
    },
    booking: {
      allPetsCompleted: remainingPets === 0,
      remainingPets,
    },
  };
}
```

### 6.2 Batch/Lot Validation

```typescript
interface BatchValidation {
  batchNumber: string;
  lotNumber?: string;
  expiryDate: string;
}

function validateBatch(batch: BatchValidation): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check expiry
  const expiry = parseISO(batch.expiryDate);
  if (isBefore(expiry, new Date())) {
    errors.push('Vaccine batch has expired');
  }
  
  // Check expiring soon (warning)
  if (isBefore(expiry, addDays(new Date(), 7))) {
    errors.push('Warning: Batch expires within 7 days');
  }
  
  // Batch number format (if applicable)
  if (!/^[A-Z0-9-]+$/i.test(batch.batchNumber)) {
    errors.push('Invalid batch number format');
  }
  
  return {
    valid: errors.filter(e => !e.startsWith('Warning')).length === 0,
    errors,
  };
}
```

---

## 7. Stage 5: Certificate Generation

### 7.1 PDF Certificate Generation

```typescript
import PDFDocument from 'pdfkit';

interface CertificateData {
  vaccination: Vaccination & {
    pet: Pet;
    vaccineType: VaccineType;
  };
  booking: CampaignBooking & {
    campaign: Campaign;
    location: CampaignLocation;
  };
  qrCodeBuffer: Buffer;
}

async function generateCertificatePdf(data: CertificateData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
  });
  
  const buffers: Buffer[] = [];
  doc.on('data', buffers.push.bind(buffers));
  
  // Header
  doc.fontSize(20).text('VACCINATION CERTIFICATE', { align: 'center' });
  doc.moveDown();
  doc.fontSize(14).text(data.booking.campaign.name, { align: 'center' });
  doc.moveDown(2);
  
  // Certificate number
  doc.fontSize(10).text(`Certificate No: ${data.vaccination.certificateToken}`, { align: 'right' });
  doc.moveDown();
  
  // Pet Information
  doc.fontSize(12).text('PET INFORMATION', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text(`Name: ${data.vaccination.pet.name}`);
  doc.text(`Species: Cat`);
  if (data.vaccination.pet.breed) {
    doc.text(`Breed: ${data.vaccination.pet.breed.name}`);
  }
  doc.moveDown();
  
  // Owner Information
  doc.fontSize(12).text('OWNER INFORMATION', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text(`Name: ${data.booking.ownerName}`);
  doc.text(`Phone: ${data.booking.ownerPhone}`);
  doc.moveDown();
  
  // Vaccination Details
  doc.fontSize(12).text('VACCINATION DETAILS', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text(`Vaccine: ${data.vaccination.vaccineType.name}`);
  doc.text(`Batch No: ${data.vaccination.batchNumber || 'N/A'}`);
  doc.text(`Date Administered: ${format(data.vaccination.administeredAt, 'dd MMMM yyyy')}`);
  doc.text(`Next Due Date: ${format(data.vaccination.nextDueDate, 'dd MMMM yyyy')}`);
  doc.text(`Location: ${data.booking.location.name}`);
  doc.moveDown();
  
  // QR Code
  doc.image(data.qrCodeBuffer, {
    fit: [150, 150],
    align: 'center',
  });
  doc.moveDown();
  doc.fontSize(8).text('Scan to verify certificate', { align: 'center' });
  
  // Footer
  doc.moveDown(2);
  doc.fontSize(8).text('This certificate is issued by Bangladesh Pet Alliance (BPA).', { align: 'center' });
  doc.text(`Verify at: https://vacc.bpa.com.bd/verify/${data.vaccination.certificateToken}`, { align: 'center' });
  
  doc.end();
  
  return new Promise((resolve) => {
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
  });
}
```

### 7.2 Certificate Caching

```typescript
async function getCertificatePdf(token: string): Promise<Buffer> {
  // Check cache first
  const cacheKey = `cert:pdf:${token}`;
  const cached = await redis.getBuffer(cacheKey);
  
  if (cached) {
    return cached;
  }
  
  // Generate
  const vaccination = await prisma.vaccination.findUnique({
    where: { certificateToken: token },
    include: {
      pet: { include: { breed: true } },
      vaccineType: true,
      campaignBooking: {
        include: {
          campaign: true,
          location: true,
        },
      },
    },
  });
  
  if (!vaccination) {
    throw new ApiError('CERTIFICATE_NOT_FOUND', 404);
  }
  
  const qrCodeBuffer = await generateQrCode(
    `https://vacc.bpa.com.bd/verify/${token}`
  );
  
  const pdf = await generateCertificatePdf({
    vaccination,
    booking: vaccination.campaignBooking,
    qrCodeBuffer,
  });
  
  // Cache for 24 hours
  await redis.setex(cacheKey, 86400, pdf);
  
  return pdf;
}
```

---

## 8. Error Handling

### 8.1 Workflow Errors

| Error | Stage | Resolution |
|-------|-------|------------|
| Booking not found | Check-in | Search by phone |
| Wrong location | Check-in | Allow with warning |
| Wrong date | Check-in | Allow with manager approval |
| Pre-check failed | Pre-check | Defer vaccination |
| Expired batch | Vaccination | Reject, use different batch |
| System error | Any | Retry, manual fallback |

### 8.2 Offline Mode

```typescript
// Staff portal can cache recent bookings for offline check-in
// Sync when back online

interface OfflineCheckIn {
  bookingRef: string;
  queueNumber: string;
  checkedInAt: string;
  staffUserId: number;
  pendingSync: boolean;
}

async function syncOfflineCheckIns(checkIns: OfflineCheckIn[]) {
  for (const checkIn of checkIns) {
    try {
      await prisma.campaignBooking.update({
        where: { bookingRef: checkIn.bookingRef },
        data: {
          status: 'CHECKED_IN',
          checkedInAt: new Date(checkIn.checkedInAt),
          checkedInByUserId: checkIn.staffUserId,
          queueNumber: checkIn.queueNumber,
        },
      });
    } catch (error) {
      // Log failed sync for manual review
      console.error(`Failed to sync check-in: ${checkIn.bookingRef}`, error);
    }
  }
}
```

---

## 9. Metrics & Monitoring

### 9.1 Real-time Metrics

```typescript
interface WorkflowMetrics {
  locationId: number;
  timestamp: Date;
  metrics: {
    avgCheckInTime: number;      // seconds
    avgVaccinationTime: number;  // seconds
    avgWaitTime: number;         // minutes
    throughputPerHour: number;
    errorRate: number;
  };
}

async function calculateWorkflowMetrics(locationId: number): Promise<WorkflowMetrics> {
  const today = startOfDay(new Date());
  
  const bookings = await prisma.campaignBooking.findMany({
    where: {
      locationId,
      bookingDate: today,
      status: { in: ['COMPLETED', 'IN_PROGRESS'] },
    },
    select: {
      checkedInAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
  
  // Calculate averages
  const times = bookings
    .filter(b => b.completedAt && b.checkedInAt)
    .map(b => ({
      checkInToComplete: differenceInSeconds(b.completedAt!, b.checkedInAt!),
    }));
  
  const avgVaccinationTime = times.length
    ? times.reduce((sum, t) => sum + t.checkInToComplete, 0) / times.length
    : 0;
  
  return {
    locationId,
    timestamp: new Date(),
    metrics: {
      avgCheckInTime: 30, // Estimated
      avgVaccinationTime,
      avgWaitTime: calculateAvgWait(bookings),
      throughputPerHour: calculateThroughput(bookings),
      errorRate: await calculateErrorRate(locationId),
    },
  };
}
```
