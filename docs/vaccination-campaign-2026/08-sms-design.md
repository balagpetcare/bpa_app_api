# SMS Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

### 1.1 SMS Use Cases

| Event | Trigger | Priority |
|-------|---------|----------|
| OTP Verification | User requests OTP | P0 (Immediate) |
| Booking Confirmation | Booking created | P0 (Immediate) |
| Booking Reschedule | Booking changed | P1 (< 1 min) |
| Booking Cancellation | Booking cancelled | P1 (< 1 min) |
| Reminder D-1 | 1 day before | P2 (Batch) |
| Reminder D-0 | Morning of | P2 (Batch) |
| Vaccination Complete | After vaccination | P0 (Immediate) |
| No-Show Follow-up | Marked no-show | P2 (< 5 min) |
| Campaign Announcement | Admin broadcast | P3 (Batch) |

### 1.2 SMS Provider Integration

```
Primary: SSL Wireless (Bangladesh)
Fallback: Bulk SMS BD
Rate: Up to 100 SMS/second
```

---

## 2. Existing Infrastructure

### 2.1 BPA Notification System

```typescript
// Existing notification service
// backend-api/src/api/v1/services/notification.service.ts

export async function createNotification(input: CreateNotificationInput) {
  // Creates notification record
  // Enqueues to BullMQ for delivery
  // Supports IN_APP, SMS, EMAIL channels
}
```

### 2.2 BullMQ Queue Structure

```typescript
// Existing queue configuration
// backend-api/src/api/v1/services/notificationQueue.ts

const smsQueue = new Queue('sms-queue', { connection: redis });

export async function enqueueSmsJob(payload: SmsJobPayload) {
  await smsQueue.add('send-sms', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}
```

---

## 3. SMS Templates

### 3.1 OTP Template

```
Template Code: CAMPAIGN_OTP
Character Count: ~60

---
BPA Vaccination Campaign
Your OTP: {{otp}}
Valid for 5 minutes.
Do not share this code.
```

### 3.2 Booking Confirmation Template

```
Template Code: BOOKING_CONFIRMED
Character Count: ~250

---
BPA Vaccination Booking Confirmed!

Ref: {{bookingRef}}
Date: {{date}}
Time: {{slot}}
Location: {{location}}

Pets: {{petNames}}

Show QR at venue:
{{qrUrl}}

Questions? 09612-345678
```

### 3.3 Booking Reschedule Template

```
Template Code: BOOKING_RESCHEDULED
Character Count: ~200

---
BPA Vaccination: Booking Updated

Ref: {{bookingRef}}
NEW Date: {{date}}
NEW Time: {{slot}}
Location: {{location}}

View: {{bookingUrl}}

Questions? 09612-345678
```

### 3.4 Booking Cancellation Template

```
Template Code: BOOKING_CANCELLED
Character Count: ~150

---
BPA Vaccination: Booking Cancelled

Ref: {{bookingRef}} has been cancelled.

{{#if refund}}
Refund: {{refundAmount}} BDT (processing)
{{/if}}

Rebook: {{rebookUrl}}
```

### 3.5 Reminder D-1 Template

```
Template Code: REMINDER_1DAY
Character Count: ~180

---
BPA Vaccination Reminder

Your appointment is TOMORROW!

Ref: {{bookingRef}}
Date: {{date}}
Time: {{slot}}
Location: {{location}}

Bring: Pet carrier, this SMS

Can't make it? Reschedule:
{{rescheduleUrl}}
```

### 3.6 Reminder D-0 Template

```
Template Code: REMINDER_TODAY
Character Count: ~160

---
BPA Vaccination TODAY!

Ref: {{bookingRef}}
Time: {{slot}}
Location: {{location}}

Show QR at venue:
{{qrUrl}}

Running late? Call: 09612-345678
```

### 3.7 Vaccination Complete Template

```
Template Code: VACCINATION_COMPLETE
Character Count: ~200

---
BPA Vaccination Complete!

{{petName}} has been vaccinated with {{vaccineName}}.

Certificate: {{certificateUrl}}

Next dose due: {{nextDueDate}}

Save this SMS for your records.

Thank you for protecting your pet!
```

### 3.8 No-Show Follow-up Template

```
Template Code: NO_SHOW_FOLLOWUP
Character Count: ~150

---
BPA Vaccination: Missed Appointment

We missed you today for {{petNames}}.

Reschedule your appointment:
{{rescheduleUrl}}

Limited slots available.
```

### 3.9 Campaign Announcement Template

```
Template Code: CAMPAIGN_ANNOUNCEMENT
Character Count: Variable (max 450)

---
BPA Vaccination Campaign Update

{{message}}

More info: {{url}}

Reply STOP to unsubscribe.
```

---

## 4. Template Configuration

### 4.1 Database Model

```prisma
model CampaignSmsTemplate {
  id         Int      @id @default(autoincrement())
  campaignId Int
  code       String   @db.VarChar(50)
  template   String   @db.Text
  variables  Json     @default("[]")  // List of required variables
  isActive   Boolean  @default(true)
  
  campaign   Campaign @relation(fields: [campaignId], references: [id])
  
  @@unique([campaignId, code])
  @@map("campaign_sms_templates")
}
```

### 4.2 Default Templates Setup

```typescript
const DEFAULT_TEMPLATES = [
  {
    code: 'CAMPAIGN_OTP',
    template: 'BPA Vaccination Campaign\nYour OTP: {{otp}}\nValid for 5 minutes.\nDo not share this code.',
    variables: ['otp'],
  },
  {
    code: 'BOOKING_CONFIRMED',
    template: 'BPA Vaccination Booking Confirmed!\n\nRef: {{bookingRef}}\nDate: {{date}}\nTime: {{slot}}\nLocation: {{location}}\n\nPets: {{petNames}}\n\nShow QR at venue:\n{{qrUrl}}\n\nQuestions? 09612-345678',
    variables: ['bookingRef', 'date', 'slot', 'location', 'petNames', 'qrUrl'],
  },
  // ... other templates
];

async function seedCampaignTemplates(campaignId: number) {
  for (const template of DEFAULT_TEMPLATES) {
    await prisma.campaignSmsTemplate.upsert({
      where: {
        campaignId_code: { campaignId, code: template.code },
      },
      create: {
        campaignId,
        ...template,
      },
      update: template,
    });
  }
}
```

---

## 5. SMS Service Implementation

### 5.1 Campaign SMS Service

```typescript
// backend-api/src/api/v1/modules/campaign/sms.service.ts

interface SendCampaignSmsInput {
  campaignId: number;
  bookingId?: number;
  phone: string;
  templateCode: string;
  variables: Record<string, string>;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
}

async function sendCampaignSms(input: SendCampaignSmsInput) {
  // 1. Get template
  const template = await prisma.campaignSmsTemplate.findUnique({
    where: {
      campaignId_code: {
        campaignId: input.campaignId,
        code: input.templateCode,
      },
    },
  });
  
  if (!template || !template.isActive) {
    throw new Error(`SMS template not found: ${input.templateCode}`);
  }
  
  // 2. Render template
  const message = renderTemplate(template.template, input.variables);
  
  // 3. Validate message length
  if (message.length > 450) {
    console.warn(`SMS message too long: ${message.length} chars`);
  }
  
  // 4. Create log entry
  const smsLog = await prisma.campaignSmsLog.create({
    data: {
      campaignId: input.campaignId,
      bookingId: input.bookingId,
      phone: input.phone,
      templateCode: input.templateCode,
      message,
      status: 'QUEUED',
    },
  });
  
  // 5. Enqueue job
  const queueOptions = getQueueOptions(input.priority || 'P1');
  await smsQueue.add('send-campaign-sms', {
    smsLogId: smsLog.id,
    phone: input.phone,
    message,
  }, queueOptions);
  
  return { smsLogId: smsLog.id, status: 'QUEUED' };
}

function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] || match;
  });
}

function getQueueOptions(priority: string) {
  switch (priority) {
    case 'P0':
      return { priority: 1, attempts: 3 };
    case 'P1':
      return { priority: 2, attempts: 3, delay: 1000 };
    case 'P2':
      return { priority: 3, attempts: 2, delay: 5000 };
    default:
      return { priority: 4, attempts: 2, delay: 10000 };
  }
}
```

### 5.2 SMS Worker

```typescript
// backend-api/src/common/queue/workers/campaignSms.worker.ts

import { Worker, Job } from 'bullmq';

interface CampaignSmsJob {
  smsLogId: number;
  phone: string;
  message: string;
}

const smsWorker = new Worker<CampaignSmsJob>(
  'sms-queue',
  async (job: Job<CampaignSmsJob>) => {
    const { smsLogId, phone, message } = job.data;
    
    try {
      // Update status to sending
      await prisma.campaignSmsLog.update({
        where: { id: smsLogId },
        data: { status: 'SENDING' },
      });
      
      // Send via gateway
      const result = await sendViaSmsGateway(phone, message);
      
      // Update status
      await prisma.campaignSmsLog.update({
        where: { id: smsLogId },
        data: {
          status: result.success ? 'SENT' : 'FAILED',
          externalId: result.messageId,
          sentAt: result.success ? new Date() : null,
          errorMessage: result.error,
        },
      });
      
      return result;
    } catch (error) {
      // Log failure
      await prisma.campaignSmsLog.update({
        where: { id: smsLogId },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
        },
      });
      
      throw error; // Trigger retry
    }
  },
  {
    connection: redis,
    concurrency: 10,
    limiter: {
      max: 100,
      duration: 1000, // 100 SMS per second
    },
  }
);

smsWorker.on('completed', (job) => {
  console.log(`SMS job ${job.id} completed`);
});

smsWorker.on('failed', (job, error) => {
  console.error(`SMS job ${job?.id} failed:`, error);
});
```

### 5.3 SMS Gateway Integration

```typescript
// backend-api/src/integrations/sms/sslWireless.ts

interface SslWirelessConfig {
  apiToken: string;
  baseUrl: string;
  senderId: string;
}

interface SmsGatewayResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

async function sendViaSmsGateway(
  phone: string,
  message: string
): Promise<SmsGatewayResult> {
  const config = getSslWirelessConfig();
  
  try {
    const response = await axios.post(
      `${config.baseUrl}/api/v3/send-sms`,
      {
        api_token: config.apiToken,
        sid: config.senderId,
        msisdn: formatBdPhone(phone),
        sms: message,
        csms_id: generateCsmsId(),
      },
      {
        timeout: 10000,
      }
    );
    
    if (response.data.status === 'SUCCESS') {
      return {
        success: true,
        messageId: response.data.smsinfo?.[0]?.sms_status || 'sent',
      };
    }
    
    return {
      success: false,
      error: response.data.message || 'Unknown error',
    };
  } catch (error) {
    // Try fallback gateway
    return sendViaFallbackGateway(phone, message);
  }
}

function formatBdPhone(phone: string): string {
  // Ensure format: 88017XXXXXXXX
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('88')) {
    return cleaned;
  }
  if (cleaned.startsWith('0')) {
    return `88${cleaned}`;
  }
  return `880${cleaned}`;
}

function generateCsmsId(): string {
  return `BPA${Date.now()}${Math.random().toString(36).substr(2, 4)}`;
}
```

---

## 6. Reminder Scheduling

### 6.1 Reminder Job Setup

```typescript
// Schedule daily reminder job
// Runs at 6:00 AM local time

import { CronJob } from 'bullmq';

async function setupReminderJobs() {
  // D-1 reminders at 6 PM
  await reminderQueue.add(
    'send-d1-reminders',
    {},
    {
      repeat: {
        pattern: '0 18 * * *', // 6 PM daily
      },
    }
  );
  
  // D-0 reminders at 7 AM
  await reminderQueue.add(
    'send-d0-reminders',
    {},
    {
      repeat: {
        pattern: '0 7 * * *', // 7 AM daily
      },
    }
  );
}
```

### 6.2 Reminder Worker

```typescript
// D-1 Reminder Worker
async function processD1Reminders() {
  const tomorrow = addDays(startOfDay(new Date()), 1);
  
  const bookings = await prisma.campaignBooking.findMany({
    where: {
      bookingDate: tomorrow,
      status: 'CONFIRMED',
      campaign: { status: 'ACTIVE' },
    },
    include: {
      campaign: true,
      location: true,
      slot: true,
      pets: true,
    },
  });
  
  console.log(`Sending D-1 reminders to ${bookings.length} bookings`);
  
  for (const booking of bookings) {
    await sendCampaignSms({
      campaignId: booking.campaignId,
      bookingId: booking.id,
      phone: booking.ownerPhone,
      templateCode: 'REMINDER_1DAY',
      variables: {
        bookingRef: booking.bookingRef,
        date: format(booking.bookingDate, 'dd MMM yyyy'),
        slot: `${booking.slot.startTime} - ${booking.slot.endTime}`,
        location: booking.location.name,
        rescheduleUrl: `https://vacc.bpa.com.bd/reschedule/${booking.bookingRef}`,
      },
      priority: 'P2',
    });
    
    // Rate limiting
    await sleep(100); // 10 SMS per second for batch
  }
}

// D-0 Reminder Worker
async function processD0Reminders() {
  const today = startOfDay(new Date());
  
  const bookings = await prisma.campaignBooking.findMany({
    where: {
      bookingDate: today,
      status: 'CONFIRMED',
      campaign: { status: 'ACTIVE' },
    },
    include: {
      campaign: true,
      location: true,
      slot: true,
    },
  });
  
  console.log(`Sending D-0 reminders to ${bookings.length} bookings`);
  
  for (const booking of bookings) {
    await sendCampaignSms({
      campaignId: booking.campaignId,
      bookingId: booking.id,
      phone: booking.ownerPhone,
      templateCode: 'REMINDER_TODAY',
      variables: {
        bookingRef: booking.bookingRef,
        slot: `${booking.slot.startTime} - ${booking.slot.endTime}`,
        location: booking.location.name,
        qrUrl: `https://vacc.bpa.com.bd/c/${booking.qrToken}`,
      },
      priority: 'P2',
    });
    
    await sleep(100);
  }
}
```

---

## 7. Bulk SMS (Admin)

### 7.1 Broadcast API

```typescript
// POST /campaign-admin/sms/broadcast
interface BroadcastSmsRequest {
  campaignId: number;
  message: string;
  targetFilter: {
    status?: BookingStatus[];
    locationIds?: number[];
    dateFrom?: string;
    dateTo?: string;
  };
  scheduleAt?: string; // ISO date or null for immediate
}

async function broadcastSms(req: BroadcastSmsRequest, adminUserId: number) {
  // 1. Build target query
  const where: any = {
    campaignId: req.campaignId,
  };
  
  if (req.targetFilter.status) {
    where.status = { in: req.targetFilter.status };
  }
  if (req.targetFilter.locationIds) {
    where.locationId = { in: req.targetFilter.locationIds };
  }
  if (req.targetFilter.dateFrom || req.targetFilter.dateTo) {
    where.bookingDate = {};
    if (req.targetFilter.dateFrom) {
      where.bookingDate.gte = new Date(req.targetFilter.dateFrom);
    }
    if (req.targetFilter.dateTo) {
      where.bookingDate.lte = new Date(req.targetFilter.dateTo);
    }
  }
  
  // 2. Get unique phone numbers
  const bookings = await prisma.campaignBooking.findMany({
    where,
    select: { ownerPhone: true },
    distinct: ['ownerPhone'],
  });
  
  const phones = bookings.map(b => b.ownerPhone);
  
  // 3. Create broadcast job
  const broadcastId = await prisma.campaignSmsBroadcast.create({
    data: {
      campaignId: req.campaignId,
      message: req.message,
      targetCount: phones.length,
      sentCount: 0,
      failedCount: 0,
      status: 'PENDING',
      createdByUserId: adminUserId,
      scheduledAt: req.scheduleAt ? new Date(req.scheduleAt) : null,
    },
  });
  
  // 4. Enqueue individual jobs
  const delay = req.scheduleAt
    ? new Date(req.scheduleAt).getTime() - Date.now()
    : 0;
  
  for (let i = 0; i < phones.length; i++) {
    await smsQueue.add(
      'broadcast-sms',
      {
        broadcastId: broadcastId.id,
        phone: phones[i],
        message: req.message,
      },
      {
        delay: delay + (i * 100), // Stagger 100ms apart
        priority: 4,
      }
    );
  }
  
  return {
    broadcastId: broadcastId.id,
    targetCount: phones.length,
    scheduledAt: req.scheduleAt || 'immediate',
  };
}
```

---

## 8. SMS Analytics

### 8.1 Tracking Schema

```prisma
model CampaignSmsLog {
  id           Int       @id @default(autoincrement())
  campaignId   Int
  bookingId    Int?
  phone        String    @db.VarChar(15)
  templateCode String?
  message      String    @db.Text
  status       SmsStatus @default(QUEUED)
  externalId   String?   @db.VarChar(64)
  errorMessage String?
  queuedAt     DateTime  @default(now())
  sentAt       DateTime?
  deliveredAt  DateTime?
  
  @@index([campaignId, status])
  @@index([bookingId])
  @@map("campaign_sms_logs")
}
```

### 8.2 Analytics Queries

```typescript
async function getSmsStats(campaignId: number) {
  const stats = await prisma.campaignSmsLog.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: true,
  });
  
  const byTemplate = await prisma.campaignSmsLog.groupBy({
    by: ['templateCode', 'status'],
    where: { campaignId },
    _count: true,
  });
  
  const dailyTrend = await prisma.$queryRaw`
    SELECT 
      DATE(queued_at) as date,
      status,
      COUNT(*) as count
    FROM campaign_sms_logs
    WHERE campaign_id = ${campaignId}
    GROUP BY DATE(queued_at), status
    ORDER BY date DESC
    LIMIT 30
  `;
  
  return {
    summary: formatStats(stats),
    byTemplate: formatTemplateStats(byTemplate),
    dailyTrend,
  };
}
```

---

## 9. Error Handling

### 9.1 Retry Strategy

| Attempt | Delay | Action |
|---------|-------|--------|
| 1 | Immediate | Send to primary gateway |
| 2 | 5 seconds | Retry primary gateway |
| 3 | 30 seconds | Try fallback gateway |
| Failed | - | Mark as failed, alert |

### 9.2 Common Errors

| Error Code | Description | Resolution |
|------------|-------------|------------|
| INVALID_PHONE | Invalid phone format | Skip, log |
| GATEWAY_TIMEOUT | Gateway not responding | Retry |
| INSUFFICIENT_BALANCE | SMS credits low | Alert admin |
| RATE_LIMITED | Too many requests | Back off |
| BLOCKED_NUMBER | DND registered | Mark undeliverable |

---

## 10. Cost Estimation

### 10.1 SMS Costs (Bangladesh)

| Type | Cost per SMS |
|------|--------------|
| Local (Grameenphone, Robi, Banglalink, Teletalk) | ৳0.25 - ৳0.35 |
| Bulk rate (10,000+) | ৳0.20 |

### 10.2 Campaign Estimation

| SMS Type | Per Booking | Total (10,000 bookings) |
|----------|-------------|-------------------------|
| OTP | 1.5 | 15,000 |
| Confirmation | 1 | 10,000 |
| Reminder D-1 | 1 | 10,000 |
| Reminder D-0 | 1 | 10,000 |
| Vaccination Complete | 1 | 10,000 |
| **Total** | **5.5** | **55,000** |
| **Cost** (@ ৳0.22) | ৳1.21 | **৳12,100** |
