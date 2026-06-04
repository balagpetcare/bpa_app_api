# Security Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Security Overview

### 1.1 Security Principles

| Principle | Implementation |
|-----------|----------------|
| Defense in Depth | Multiple security layers |
| Least Privilege | Role-based access control |
| Data Minimization | Collect only necessary data |
| Secure by Default | Security enabled by default |
| Fail Secure | Deny access on errors |

### 1.2 Threat Model

| Threat | Risk Level | Mitigation |
|--------|------------|------------|
| Unauthorized access | High | OTP auth, JWT, RBAC |
| Data breach | High | Encryption, access logging |
| Certificate fraud | Medium | QR verification, checksums |
| DDoS attack | Medium | Rate limiting, CDN |
| Injection attacks | Medium | Input validation, ORM |
| Session hijacking | Low | Secure tokens, HTTPS |

---

## 2. Authentication

### 2.1 Public User Authentication (Pet Owners)

```
OTP-Based Authentication Flow:
─────────────────────────────

1. User enters phone number
2. Server validates format (BD: 01XXXXXXXXX)
3. Rate limit check (3 requests/min/phone)
4. Generate 6-digit OTP
5. Store in Redis (TTL: 5 min, max 3 attempts)
6. Send via SMS gateway
7. User enters OTP
8. Server validates OTP
9. Issue session token (JWT)
```

```typescript
// OTP Generation & Storage
interface OtpRecord {
  otp: string;
  phone: string;
  attempts: number;
  expiresAt: Date;
  purpose: 'BOOKING' | 'VIEW_BOOKING';
}

async function generateAndSendOtp(phone: string, purpose: string): Promise<void> {
  // Rate limit check
  const rateKey = `otp:rate:${phone}`;
  const rateCount = await redis.incr(rateKey);
  if (rateCount === 1) {
    await redis.expire(rateKey, 60); // 1 minute window
  }
  if (rateCount > 3) {
    throw new ApiError('RATE_LIMITED', 'Too many OTP requests', 429);
  }
  
  // Generate secure OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  
  // Hash OTP for storage (don't store plain text)
  const otpHash = await bcrypt.hash(otp, 10);
  
  // Store with expiry
  const otpKey = `otp:${phone}:${purpose}`;
  await redis.setex(otpKey, 300, JSON.stringify({
    otpHash,
    attempts: 0,
    createdAt: Date.now(),
  }));
  
  // Send via SMS
  await smsService.send(phone, `Your BPA vaccination OTP: ${otp}. Valid for 5 minutes.`);
}

async function verifyOtp(phone: string, otp: string, purpose: string): Promise<boolean> {
  const otpKey = `otp:${phone}:${purpose}`;
  const stored = await redis.get(otpKey);
  
  if (!stored) {
    throw new ApiError('OTP_EXPIRED', 'OTP expired or not found', 400);
  }
  
  const record = JSON.parse(stored);
  
  // Check attempts
  if (record.attempts >= 3) {
    await redis.del(otpKey);
    throw new ApiError('OTP_MAX_ATTEMPTS', 'Too many failed attempts', 400);
  }
  
  // Verify OTP
  const isValid = await bcrypt.compare(otp, record.otpHash);
  
  if (!isValid) {
    record.attempts++;
    await redis.setex(otpKey, 300, JSON.stringify(record));
    throw new ApiError('OTP_INVALID', 'Invalid OTP', 400);
  }
  
  // Delete on success
  await redis.del(otpKey);
  
  return true;
}
```

### 2.2 Session Token (Public Users)

```typescript
interface PublicSessionPayload {
  type: 'public_session';
  phone: string;
  sessionId: string;
  iat: number;
  exp: number;
}

function issuePublicSession(phone: string): string {
  const sessionId = crypto.randomUUID();
  
  return jwt.sign(
    {
      type: 'public_session',
      phone,
      sessionId,
    },
    process.env.JWT_PUBLIC_SECRET!,
    { expiresIn: '24h' }
  );
}

function verifyPublicSession(token: string): PublicSessionPayload {
  return jwt.verify(token, process.env.JWT_PUBLIC_SECRET!) as PublicSessionPayload;
}
```

### 2.3 Staff Authentication

```typescript
// Staff uses existing BPA auth system
interface StaffTokenPayload {
  type: 'staff';
  userId: number;
  email: string;
  roles: string[];
  campaignAssignments: Array<{
    campaignId: number;
    locationId: number | null;
    role: CampaignStaffRole;
  }>;
  iat: number;
  exp: number;
}

async function authenticateStaff(email: string, password: string): Promise<string> {
  // Use existing BPA auth
  const user = await prisma.user.findFirst({
    where: {
      auth: { email },
      status: 'ACTIVE',
    },
    include: {
      auth: true,
      campaignStaff: {
        where: { isActive: true },
        include: { campaign: true },
      },
    },
  });
  
  if (!user || !user.auth) {
    throw new ApiError('INVALID_CREDENTIALS', 401);
  }
  
  const validPassword = await bcrypt.compare(password, user.auth.passwordHash!);
  if (!validPassword) {
    throw new ApiError('INVALID_CREDENTIALS', 401);
  }
  
  // Check for campaign assignments
  if (!user.campaignStaff.length) {
    throw new ApiError('NO_CAMPAIGN_ACCESS', 'Not assigned to any campaign', 403);
  }
  
  return jwt.sign(
    {
      type: 'staff',
      userId: user.id,
      email: user.auth.email,
      roles: user.campaignStaff.map((cs) => cs.role),
      campaignAssignments: user.campaignStaff.map((cs) => ({
        campaignId: cs.campaignId,
        locationId: cs.locationId,
        role: cs.role,
      })),
    },
    process.env.JWT_STAFF_SECRET!,
    { expiresIn: '12h' }
  );
}
```

---

## 3. Authorization

### 3.1 Role-Based Access Control

```typescript
// middleware/campaignAuth.ts

enum CampaignPermission {
  VIEW_CAMPAIGN = 'view_campaign',
  MANAGE_CAMPAIGN = 'manage_campaign',
  CHECK_IN = 'check_in',
  REGISTER_WALK_IN = 'register_walk_in',
  RECORD_VACCINATION = 'record_vaccination',
  VIEW_QUEUE = 'view_queue',
  MANAGE_QUEUE = 'manage_queue',
  VIEW_REPORTS = 'view_reports',
  EXPORT_DATA = 'export_data',
  MANAGE_STAFF = 'manage_staff',
}

const ROLE_PERMISSIONS: Record<CampaignStaffRole, CampaignPermission[]> = {
  CHECK_IN: [
    CampaignPermission.VIEW_CAMPAIGN,
    CampaignPermission.CHECK_IN,
    CampaignPermission.REGISTER_WALK_IN,
    CampaignPermission.VIEW_QUEUE,
  ],
  VACCINATOR: [
    CampaignPermission.VIEW_CAMPAIGN,
    CampaignPermission.CHECK_IN,
    CampaignPermission.REGISTER_WALK_IN,
    CampaignPermission.RECORD_VACCINATION,
    CampaignPermission.VIEW_QUEUE,
    CampaignPermission.MANAGE_QUEUE,
  ],
  COORDINATOR: [
    CampaignPermission.VIEW_CAMPAIGN,
    CampaignPermission.CHECK_IN,
    CampaignPermission.REGISTER_WALK_IN,
    CampaignPermission.RECORD_VACCINATION,
    CampaignPermission.VIEW_QUEUE,
    CampaignPermission.MANAGE_QUEUE,
    CampaignPermission.VIEW_REPORTS,
  ],
  ADMIN: Object.values(CampaignPermission),
};

function requirePermission(permission: CampaignPermission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const staff = req.staff as StaffTokenPayload;
    const campaignId = parseInt(req.params.campaignId);
    
    const assignment = staff.campaignAssignments.find(
      (a) => a.campaignId === campaignId
    );
    
    if (!assignment) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Not assigned to this campaign',
      });
    }
    
    const permissions = ROLE_PERMISSIONS[assignment.role];
    
    if (!permissions.includes(permission)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Missing permission: ${permission}`,
      });
    }
    
    next();
  };
}
```

### 3.2 Location-Based Authorization

```typescript
// Check staff is assigned to specific location
function requireLocationAccess(req: Request, res: Response, next: NextFunction) {
  const staff = req.staff as StaffTokenPayload;
  const locationId = parseInt(req.params.locationId);
  const campaignId = parseInt(req.params.campaignId);
  
  const assignment = staff.campaignAssignments.find(
    (a) => a.campaignId === campaignId &&
          (a.locationId === null || a.locationId === locationId)
  );
  
  if (!assignment) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Not authorized for this location',
    });
  }
  
  next();
}
```

---

## 4. Data Protection

### 4.1 Data Classification

| Classification | Examples | Protection |
|----------------|----------|------------|
| Public | Campaign name, dates | None required |
| Internal | Aggregate stats | Authentication required |
| Confidential | Phone numbers, names | Encryption, access control |
| Sensitive | NID (if collected) | Not stored, additional controls |

### 4.2 Encryption

```typescript
// Data at rest: PostgreSQL with encryption
// Data in transit: TLS 1.3

// Phone number display masking
function maskPhone(phone: string): string {
  // 01712345678 -> 01712***678
  if (phone.length >= 8) {
    return `${phone.slice(0, 5)}***${phone.slice(-3)}`;
  }
  return phone;
}

// Certificate token encryption (optional extra layer)
const CERT_ENCRYPTION_KEY = process.env.CERT_ENCRYPTION_KEY!;

function encryptCertificateData(data: object): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', CERT_ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
```

### 4.3 Audit Logging

```typescript
// All sensitive operations are logged
interface AuditLogEntry {
  id: number;
  campaignId: number;
  actorUserId: number | null;
  actorRole: string;
  actorIp: string;
  action: string;
  entityType: string;
  entityId: number | null;
  beforeJson: object | null;
  afterJson: object | null;
  metadataJson: object | null;
  createdAt: Date;
}

async function logAudit(entry: Omit<AuditLogEntry, 'id' | 'createdAt'>) {
  await prisma.campaignAuditLog.create({
    data: {
      ...entry,
      beforeJson: entry.beforeJson as any,
      afterJson: entry.afterJson as any,
      metadataJson: entry.metadataJson as any,
    },
  });
}

// Audit hooks for sensitive operations
const AUDITED_ACTIONS = [
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'BOOKING_CHECKED_IN',
  'VACCINATION_RECORDED',
  'VACCINATION_VOIDED',
  'CERTIFICATE_GENERATED',
  'CERTIFICATE_REVOKED',
  'STAFF_ASSIGNED',
  'STAFF_REMOVED',
  'CAMPAIGN_MODIFIED',
];
```

---

## 5. Rate Limiting

### 5.1 Rate Limit Configuration

```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

// Global rate limiter
const globalLimiter = rateLimit({
  store: new RedisStore({ client: redis }),
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'RATE_LIMITED', message: 'Too many requests' },
});

// OTP rate limiter (stricter)
const otpLimiter = rateLimit({
  store: new RedisStore({ client: redis }),
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.body.phone || req.ip,
  message: { error: 'RATE_LIMITED', message: 'Too many OTP requests' },
});

// Booking rate limiter
const bookingLimiter = rateLimit({
  store: new RedisStore({ client: redis }),
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.phone || req.ip,
  message: { error: 'RATE_LIMITED', message: 'Too many booking attempts' },
});

// Verification rate limiter
const verifyLimiter = rateLimit({
  store: new RedisStore({ client: redis }),
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip,
  message: { error: 'RATE_LIMITED', message: 'Too many verification requests' },
});

// Apply limiters
app.use('/api/v1/campaign-otp', otpLimiter);
app.use('/api/v1/campaign-booking', bookingLimiter);
app.use('/api/v1/campaign-certificate/*/verify', verifyLimiter);
app.use('/api/v1/', globalLimiter);
```

### 5.2 Slot Concurrency Protection

```typescript
// Prevent overbooking with distributed locking
import Redlock from 'redlock';

const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200,
});

async function bookSlot(slotId: number, bookingData: BookingData) {
  const lockKey = `lock:slot:${slotId}`;
  
  let lock;
  try {
    lock = await redlock.acquire([lockKey], 5000); // 5 second lock
    
    // Check capacity within lock
    const slot = await prisma.campaignSlot.findUnique({
      where: { id: slotId },
    });
    
    if (slot.bookedCount >= slot.capacity) {
      throw new ApiError('SLOT_FULL', 'Slot is no longer available', 409);
    }
    
    // Create booking and increment counter atomically
    const booking = await prisma.$transaction([
      prisma.campaignBooking.create({ data: bookingData }),
      prisma.campaignSlot.update({
        where: { id: slotId },
        data: { bookedCount: { increment: 1 } },
      }),
    ]);
    
    return booking;
  } finally {
    if (lock) {
      await lock.release();
    }
  }
}
```

---

## 6. Input Validation

### 6.1 Schema Validation

```typescript
import { z } from 'zod';

// Phone validation (Bangladesh format)
const bdPhoneSchema = z.string()
  .regex(/^01[3-9]\d{8}$/, 'Invalid Bangladesh phone number');

// Booking request validation
const createBookingSchema = z.object({
  campaignId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  slotId: z.number().int().positive(),
  owner: z.object({
    name: z.string().min(2).max(100).trim(),
    address: z.object({
      division: z.string().max(50).optional(),
      district: z.string().max(50).optional(),
      area: z.string().max(100).optional(),
    }).optional(),
  }),
  pets: z.array(z.object({
    name: z.string().min(1).max(50).trim(),
    breedId: z.number().int().positive().optional(),
    gender: z.enum(['MALE', 'FEMALE']).optional(),
    ageMonths: z.number().int().min(0).max(360).optional(),
    colorDescription: z.string().max(100).optional(),
  })).min(1).max(5),
});

// Validation middleware
function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.errors,
        });
      } else {
        next(error);
      }
    }
  };
}
```

### 6.2 SQL Injection Prevention

```typescript
// Prisma ORM automatically handles parameterized queries
// All user input is escaped

// DON'T do this:
// const result = await prisma.$queryRaw`SELECT * FROM users WHERE phone = ${phone}`;

// DO this:
const result = await prisma.campaignBooking.findMany({
  where: {
    ownerPhone: phone, // Prisma handles escaping
  },
});

// For raw queries when necessary, use parameterized queries:
const results = await prisma.$queryRaw`
  SELECT * FROM campaign_bookings 
  WHERE owner_phone = ${phone}::text
  AND campaign_id = ${campaignId}::int
`;
```

### 6.3 XSS Prevention

```typescript
import DOMPurify from 'isomorphic-dompurify';

// Sanitize any user-provided HTML (if applicable)
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br'],
    ALLOWED_ATTR: [],
  });
}

// For text fields, simple sanitization
function sanitizeText(text: string): string {
  return text
    .replace(/[<>]/g, '') // Remove angle brackets
    .trim()
    .slice(0, 1000); // Limit length
}

// React automatically escapes content in JSX
// But be careful with dangerouslySetInnerHTML
```

---

## 7. Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // For React
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://cdn.bpa.com.bd"],
      connectSrc: ["'self'", "https://api.bpa.com.bd"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  noSniff: true,
  xssFilter: true,
  frameguard: { action: 'deny' },
}));

// CORS configuration
app.use(cors({
  origin: [
    'https://vacc.bpa.com.bd',
    'https://admin.bpa.com.bd',
    process.env.NODE_ENV === 'development' && 'http://localhost:3000',
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```

---

## 8. Incident Response

### 8.1 Security Monitoring

```typescript
// Security event detection
async function detectSecurityEvents() {
  const hourAgo = new Date(Date.now() - 3600000);
  
  // High OTP failure rate
  const otpFailures = await prisma.auditLog.count({
    where: {
      action: 'OTP_FAILED',
      createdAt: { gte: hourAgo },
    },
  });
  
  if (otpFailures > 100) {
    await alertSecurityTeam('HIGH_OTP_FAILURES', { count: otpFailures });
  }
  
  // Unusual API activity
  const apiCalls = await redis.get('api:calls:hour');
  if (parseInt(apiCalls) > 100000) {
    await alertSecurityTeam('HIGH_API_TRAFFIC', { count: apiCalls });
  }
  
  // Multiple failed logins
  const failedLogins = await prisma.auditLog.count({
    where: {
      action: 'STAFF_LOGIN_FAILED',
      createdAt: { gte: hourAgo },
    },
  });
  
  if (failedLogins > 50) {
    await alertSecurityTeam('HIGH_LOGIN_FAILURES', { count: failedLogins });
  }
}
```

### 8.2 Incident Response Procedures

| Severity | Response Time | Actions |
|----------|---------------|---------|
| Critical (data breach) | Immediate | Isolate system, notify stakeholders, investigate |
| High (active attack) | < 1 hour | Block IPs, enable extra logging, investigate |
| Medium (suspicious activity) | < 4 hours | Review logs, strengthen controls |
| Low (policy violation) | < 24 hours | Document, address in next cycle |

---

## 9. Compliance

### 9.1 Data Retention

| Data Type | Retention Period | Deletion Method |
|-----------|------------------|-----------------|
| Booking data | 5 years | Soft delete, then purge |
| Vaccination records | Permanent | N/A |
| SMS logs | 1 year | Hard delete |
| Audit logs | 5 years | Archive to cold storage |
| OTP records | 5 minutes | Auto-expire in Redis |
| Session tokens | 24 hours | Auto-expire |

### 9.2 Privacy Considerations

- Phone numbers used only for authentication and communication
- No personal data shared with third parties without consent
- Users can request data deletion (except medical records)
- Clear privacy policy on campaign website
