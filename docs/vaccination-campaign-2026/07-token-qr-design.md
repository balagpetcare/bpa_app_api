# Token & QR Code Design

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

The campaign uses multiple token types for different purposes:

| Token Type | Purpose | Format | Example |
|------------|---------|--------|---------|
| Booking Reference | Human-readable identifier | `VAC-XXXXXX` | `VAC-ABC123` |
| QR Token | Machine-scannable check-in | 32 characters | `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6` |
| Certificate Token | Verification token | 16 characters | `CERT-XYZ78901234` |
| Queue Number | On-site queue | `A###` or `W###` | `A042`, `W015` |

---

## 2. Booking Reference

### 2.1 Format

```
VAC-XXXXXX

Where:
- VAC = Vaccination Campaign prefix
- XXXXXX = 6 alphanumeric characters (uppercase)

Examples:
- VAC-ABC123
- VAC-XYZ789
- VAC-M2N4P6
```

### 2.2 Generation Algorithm

```typescript
function generateBookingRef(): string {
  const prefix = 'VAC';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding ambiguous: I, O, 0, 1
  let suffix = '';
  
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return `${prefix}-${suffix}`;
}

// Ensure uniqueness
async function createUniqueBookingRef(): Promise<string> {
  let ref: string;
  let attempts = 0;
  const maxAttempts = 10;
  
  do {
    ref = generateBookingRef();
    const exists = await prisma.campaignBooking.findUnique({
      where: { bookingRef: ref },
    });
    
    if (!exists) {
      return ref;
    }
    
    attempts++;
  } while (attempts < maxAttempts);
  
  // Fallback: Add timestamp-based suffix
  return `VAC-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}
```

### 2.3 Collision Analysis

- Character set: 32 characters
- Length: 6 characters
- Possible combinations: 32^6 = 1,073,741,824 (1+ billion)
- Expected bookings per campaign: ~50,000
- Collision probability: Negligible with uniqueness check

---

## 3. QR Token

### 3.1 Format

```
32-character hexadecimal string

Example: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### 3.2 Generation

```typescript
import { randomBytes } from 'crypto';

function generateQrToken(): string {
  return randomBytes(16).toString('hex');
}

// Alternative: UUID-based
import { v4 as uuidv4 } from 'uuid';

function generateQrTokenUUID(): string {
  return uuidv4().replace(/-/g, '');
}
```

### 3.3 QR Token Contents

The QR code encodes a URL for universal scanning:

```
https://vacc.bpa.com.bd/c/{qrToken}

Example:
https://vacc.bpa.com.bd/c/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

When scanned:
- **Staff app**: Extracts token, calls check-in API
- **Generic scanner**: Opens mobile browser with booking details
- **WhatsApp/social**: Shows booking preview via Open Graph

### 3.4 QR Code Generation

```typescript
import QRCode from 'qrcode';

interface QrOptions {
  width: number;
  margin: number;
  color: {
    dark: string;
    light: string;
  };
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
}

async function generateBookingQrCode(
  qrToken: string,
  options?: Partial<QrOptions>
): Promise<Buffer> {
  const url = `https://vacc.bpa.com.bd/c/${qrToken}`;
  
  const defaultOptions: QrOptions = {
    width: 300,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  };
  
  const config = { ...defaultOptions, ...options };
  
  // Generate as PNG buffer
  return QRCode.toBuffer(url, {
    width: config.width,
    margin: config.margin,
    color: config.color,
    errorCorrectionLevel: config.errorCorrectionLevel,
  });
}

// Generate as Data URL (for embedding in pages)
async function generateQrCodeDataUrl(qrToken: string): Promise<string> {
  const url = `https://vacc.bpa.com.bd/c/${qrToken}`;
  return QRCode.toDataURL(url, {
    width: 200,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}

// Generate as SVG (for printing)
async function generateQrCodeSvg(qrToken: string): Promise<string> {
  const url = `https://vacc.bpa.com.bd/c/${qrToken}`;
  return QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'H', // High for print
  });
}
```

### 3.5 QR Code Storage

```typescript
async function saveQrCode(qrToken: string): Promise<string> {
  const buffer = await generateBookingQrCode(qrToken, {
    width: 400,
    errorCorrectionLevel: 'H',
  });
  
  // Upload to MinIO/S3
  const key = `qr/bookings/${qrToken}.png`;
  await s3.putObject({
    Bucket: 'bpa-campaign',
    Key: key,
    Body: buffer,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=31536000', // 1 year cache
  });
  
  return `https://cdn.bpa.com.bd/${key}`;
}
```

---

## 4. Certificate Token

### 4.1 Format

```
CERT-XXXXXXXXXXXX

Where:
- CERT = Certificate prefix
- XXXXXXXXXXXX = 12 alphanumeric characters

Example: CERT-XYZ789012345
```

### 4.2 Generation

```typescript
function generateCertificateToken(): string {
  const prefix = 'CERT';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let code = '';
  
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return `${prefix}-${code}`;
}

// With checksum for validation
function generateCertificateTokenWithChecksum(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let code = '';
  
  // Generate 11 characters
  for (let i = 0; i < 11; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Calculate checksum (simple mod-based)
  const sum = code.split('').reduce((acc, char) => acc + chars.indexOf(char), 0);
  const checksum = chars.charAt(sum % chars.length);
  
  return `CERT-${code}${checksum}`;
}

function validateCertificateChecksum(token: string): boolean {
  const code = token.replace('CERT-', '');
  if (code.length !== 12) return false;
  
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const body = code.slice(0, 11);
  const checksum = code.charAt(11);
  
  const sum = body.split('').reduce((acc, char) => acc + chars.indexOf(char), 0);
  const expectedChecksum = chars.charAt(sum % chars.length);
  
  return checksum === expectedChecksum;
}
```

### 4.3 Certificate QR Code

```
https://vacc.bpa.com.bd/verify/{certificateToken}

Example:
https://vacc.bpa.com.bd/verify/CERT-XYZ789012345
```

---

## 5. Queue Number

### 5.1 Format

```
Type Prefix + 3-digit number

Types:
- A### = Appointment (scheduled booking)
- W### = Walk-in

Examples: A001, A042, W001, W015
```

### 5.2 Generation

```typescript
async function generateQueueNumber(
  locationId: number,
  date: Date,
  isWalkIn: boolean
): Promise<string> {
  const prefix = isWalkIn ? 'W' : 'A';
  const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Use Redis for atomic counter
  const counterKey = `queue:${locationId}:${dateKey}:${prefix}`;
  const count = await redis.incr(counterKey);
  
  // Set expiry at end of day (reset daily)
  const ttl = getSecondsUntilMidnight();
  await redis.expire(counterKey, ttl);
  
  return `${prefix}${count.toString().padStart(3, '0')}`;
}

function getSecondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}
```

### 5.3 Queue Display

```typescript
interface QueueStatus {
  currentNumber: string;
  nextNumbers: string[];
  estimatedWait: number; // minutes
}

async function getQueueStatus(locationId: number): Promise<QueueStatus> {
  const checkedIn = await prisma.campaignBooking.findMany({
    where: {
      locationId,
      status: 'CHECKED_IN',
      bookingDate: startOfDay(new Date()),
    },
    orderBy: { checkedInAt: 'asc' },
    select: { queueNumber: true },
  });
  
  const inProgress = await prisma.campaignBooking.findFirst({
    where: {
      locationId,
      status: 'IN_PROGRESS',
      bookingDate: startOfDay(new Date()),
    },
    select: { queueNumber: true },
  });
  
  return {
    currentNumber: inProgress?.queueNumber || checkedIn[0]?.queueNumber || '-',
    nextNumbers: checkedIn.slice(0, 5).map(b => b.queueNumber),
    estimatedWait: checkedIn.length * 3, // ~3 min per pet
  };
}
```

---

## 6. QR Scanning Implementation

### 6.1 Staff Portal Scanner

```typescript
// React component for staff portal
import { useState, useCallback } from 'react';
import { QrReader } from 'react-qr-reader';

function QrScanner({ onScan }: { onScan: (token: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  
  const handleScan = useCallback((result: string | null) => {
    if (!result) return;
    
    // Extract token from URL
    const match = result.match(/\/c\/([a-f0-9]{32})/i);
    if (match) {
      onScan(match[1]);
    } else {
      setError('Invalid QR code format');
    }
  }, [onScan]);
  
  return (
    <div className="qr-scanner">
      <QrReader
        constraints={{ facingMode: 'environment' }}
        onResult={(result) => {
          if (result) {
            handleScan(result.getText());
          }
        }}
        scanDelay={300}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

### 6.2 API Check-in by QR

```typescript
// POST /campaign-checkin/scan
interface QrScanRequest {
  qrToken: string;
  locationId: number;
}

async function handleQrScan(req: QrScanRequest, staffUserId: number) {
  // 1. Find booking by QR token
  const booking = await prisma.campaignBooking.findUnique({
    where: { qrToken: req.qrToken },
    include: {
      campaign: true,
      location: true,
      slot: true,
      pets: true,
    },
  });
  
  if (!booking) {
    throw new ApiError('INVALID_QR', 'Booking not found', 404);
  }
  
  // 2. Validate location
  if (booking.locationId !== req.locationId) {
    return {
      booking,
      validation: {
        isValidLocation: false,
        message: `This booking is for ${booking.location.name}`,
      },
    };
  }
  
  // 3. Validate date/time
  const now = new Date();
  const slotDate = new Date(booking.slot.date);
  const isToday = isSameDay(now, slotDate);
  const isValidTime = isWithinSlotWindow(now, booking.slot);
  
  const validation = {
    isValidLocation: true,
    isCorrectDate: isToday,
    isOnTime: isValidTime,
    warnings: [] as string[],
  };
  
  if (!isToday) {
    validation.warnings.push(
      `Booking is for ${format(slotDate, 'MMM d, yyyy')}`
    );
  }
  
  if (!isValidTime && isToday) {
    validation.warnings.push(
      `Scheduled time: ${booking.slot.startTime} - ${booking.slot.endTime}`
    );
  }
  
  return { booking, validation };
}

function isWithinSlotWindow(now: Date, slot: CampaignSlot): boolean {
  const slotStart = parseTime(slot.startTime);
  const slotEnd = parseTime(slot.endTime);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  // Allow 30 min early, 60 min late
  const windowStart = slotStart - 30;
  const windowEnd = slotEnd + 60;
  
  return currentMinutes >= windowStart && currentMinutes <= windowEnd;
}
```

---

## 7. Security Considerations

### 7.1 Token Security

| Token | Entropy | Brute Force Protection |
|-------|---------|------------------------|
| Booking Ref | Low (32^6) | Rate limiting |
| QR Token | High (16 bytes) | Not guessable |
| Certificate Token | Medium (36^12) | Checksum validation |

### 7.2 QR Code Security

```typescript
// Add HMAC signature to QR URL for tamper detection
import crypto from 'crypto';

const QR_SECRET = process.env.QR_SECRET!;

function signQrUrl(qrToken: string): string {
  const signature = crypto
    .createHmac('sha256', QR_SECRET)
    .update(qrToken)
    .digest('hex')
    .slice(0, 8);
  
  return `https://vacc.bpa.com.bd/c/${qrToken}?s=${signature}`;
}

function verifyQrSignature(qrToken: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', QR_SECRET)
    .update(qrToken)
    .digest('hex')
    .slice(0, 8);
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### 7.3 Rate Limiting

```typescript
// Redis-based rate limiting for QR scans
async function checkScanRateLimit(
  staffUserId: number,
  ipAddress: string
): Promise<boolean> {
  const userKey = `scan:user:${staffUserId}`;
  const ipKey = `scan:ip:${ipAddress}`;
  
  const multi = redis.multi();
  multi.incr(userKey);
  multi.expire(userKey, 60);
  multi.incr(ipKey);
  multi.expire(ipKey, 60);
  
  const results = await multi.exec();
  const userCount = results[0][1] as number;
  const ipCount = results[2][1] as number;
  
  // Max 60 scans per minute per user
  // Max 120 scans per minute per IP
  return userCount <= 60 && ipCount <= 120;
}
```

---

## 8. Printing & Display

### 8.1 Booking Confirmation Card

```
┌─────────────────────────────────────────────┐
│                                             │
│     BPA VACCINATION CAMPAIGN 2026           │
│                                             │
│  ┌───────────────┐                          │
│  │               │   Booking: VAC-ABC123    │
│  │   [QR CODE]   │   Date: July 15, 2026    │
│  │               │   Time: 09:00 - 12:00    │
│  │               │                          │
│  └───────────────┘   Location:              │
│                      Dhaka Central Vet      │
│  Owner: John Doe                            │
│  Phone: 01712345678                         │
│                                             │
│  Pets: Mittens, Whiskers                    │
│                                             │
│  Scan QR code at venue for check-in         │
│                                             │
└─────────────────────────────────────────────┘
```

### 8.2 SMS Format

```
BPA Vaccination Booking Confirmed!

Ref: VAC-ABC123
Date: 15 Jul 2026
Time: 09:00-12:00
Venue: Dhaka Central Vet

Pets: Mittens, Whiskers

Show QR at venue:
vacc.bpa.com.bd/c/a1b2c3d...

Questions? 09612-345678
```

### 8.3 Queue Ticket Print

```
┌─────────────────────────┐
│                         │
│         A042            │
│                         │
│   Vaccination Queue     │
│                         │
│   John Doe              │
│   2 cats                │
│                         │
│   Wait for your number  │
│   to be called          │
│                         │
│   15 Jul 2026 09:15     │
│                         │
└─────────────────────────┘
```

---

## 9. Edge Cases

### 9.1 Duplicate Scans

```typescript
async function handleDuplicateScan(booking: CampaignBooking) {
  if (booking.status === 'CHECKED_IN') {
    return {
      success: true,
      message: 'Already checked in',
      booking,
      queueNumber: booking.queueNumber,
    };
  }
  
  if (booking.status === 'COMPLETED') {
    return {
      success: false,
      message: 'Vaccination already completed',
      certificates: await getCertificates(booking.id),
    };
  }
}
```

### 9.2 Expired/Invalid QR

```typescript
function validateQrToken(qrToken: string): ValidationResult {
  // Check format
  if (!/^[a-f0-9]{32}$/i.test(qrToken)) {
    return { valid: false, reason: 'INVALID_FORMAT' };
  }
  
  // Additional checks can be added
  return { valid: true };
}
```

### 9.3 Screenshot/Photo of QR

- QR tokens are single-use for check-in
- Status changes to CHECKED_IN after first scan
- Subsequent scans show "Already checked in" message
