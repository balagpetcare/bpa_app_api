# Reporting Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

The reporting system provides real-time dashboards and exportable reports for:
- Campaign performance monitoring
- Vaccination coverage tracking
- Financial reconciliation
- Operational insights

---

## 2. Report Categories

### 2.1 Report Types

| Category | Reports | Audience |
|----------|---------|----------|
| Operational | Daily summary, queue stats, staff performance | Coordinators |
| Campaign | Booking trends, vaccination rates, no-shows | Managers |
| Financial | Revenue, payment status, refunds | Finance team |
| Coverage | Geographic coverage, breed distribution | Leadership |
| Compliance | Audit trail, certificate verification | Compliance |

---

## 3. Dashboard Design

### 3.1 Real-Time Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Campaign Dashboard: 2026 Cat Flu + Rabies                             │
│  Status: ACTIVE │ Day 5 of 30                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │    1,245    │ │    1,089    │ │      156    │ │      87%    │       │
│  │   Bookings  │ │ Vaccinated  │ │  Remaining  │ │ Show Rate   │       │
│  │   ↑ 12%     │ │   ↑ 15%     │ │   ↓ 8%      │ │   ↑ 2%      │       │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                                         │
│  ┌───────────────────────────────────┐ ┌─────────────────────────────┐ │
│  │  Vaccinations Over Time           │ │  Today's Progress           │ │
│  │                                   │ │                             │ │
│  │  200 ┤         ╭─╮                │ │  Booked:    145             │ │
│  │  150 ┤     ╭───╯ ╰──╮             │ │  Checked:   132             │ │
│  │  100 ┤ ╭───╯        ╰──╮          │ │  Vaccinated: 118            │ │
│  │   50 ┼─╯               ╰──        │ │  No-show:    13             │ │
│  │    0 ┼──┬──┬──┬──┬──┬──┬──        │ │  Walk-in:    22             │ │
│  │       1  2  3  4  5  6  7         │ │                             │ │
│  │             Day                   │ │  ████████████░░░ 81%        │ │
│  └───────────────────────────────────┘ └─────────────────────────────┘ │
│                                                                         │
│  ┌───────────────────────────────────┐ ┌─────────────────────────────┐ │
│  │  By Location                      │ │  By Vaccine Type            │ │
│  │                                   │ │                             │ │
│  │  Dhaka Central    ████████ 345    │ │  Rabies        ████████ 65% │ │
│  │  Chittagong       ██████   289    │ │  Cat Flu       ██████   35% │ │
│  │  Sylhet           █████    201    │ │                             │ │
│  │  Rajshahi         ████     156    │ │                             │ │
│  │  Khulna           ███      98     │ │                             │ │
│  └───────────────────────────────────┘ └─────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Location Performance View

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Location Performance                                         [Export] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Location           │ Booked │ Done │ Rate  │ Wait │ Staff │ Score │ │
│  ├───────────────────────────────────────────────────────────────────┤ │
│  │ Dhaka Central      │    345 │  312 │ 90.4% │ 12m  │     6 │   A+  │ │
│  │ Chittagong Vet     │    289 │  245 │ 84.8% │ 18m  │     4 │   A   │ │
│  │ Sylhet Animal      │    201 │  178 │ 88.6% │ 15m  │     3 │   A   │ │
│  │ Rajshahi Pet       │    156 │  128 │ 82.1% │ 22m  │     3 │   B+  │ │
│  │ Khulna Clinic      │     98 │   76 │ 77.6% │ 28m  │     2 │   B   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Avg Wait Time: 19 min │ Avg Staff Efficiency: 28 vacc/staff/day       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Report Specifications

### 4.1 Daily Summary Report

```typescript
interface DailySummaryReport {
  date: string;
  campaignId: number;
  
  bookings: {
    total: number;
    new: number;
    cancelled: number;
    byChannel: Record<'ONLINE' | 'WALK_IN', number>;
  };
  
  vaccinations: {
    total: number;
    byVaccineType: Array<{
      vaccineTypeId: number;
      vaccineName: string;
      count: number;
    }>;
    byLocation: Array<{
      locationId: number;
      locationName: string;
      count: number;
    }>;
  };
  
  attendance: {
    scheduled: number;
    checkedIn: number;
    completed: number;
    noShow: number;
    showRate: number;
    completionRate: number;
  };
  
  queue: {
    avgWaitTime: number;
    maxWaitTime: number;
    avgServiceTime: number;
  };
  
  financial: {
    totalRevenue: number;
    onlinePayments: number;
    onsitePayments: number;
    refunds: number;
    pendingPayments: number;
  };
}

async function generateDailySummary(campaignId: number, date: Date): Promise<DailySummaryReport> {
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));
  
  const [bookings, vaccinations, attendance, queue, financial] = await Promise.all([
    getBookingStats(campaignId, startOfDay, endOfDay),
    getVaccinationStats(campaignId, startOfDay, endOfDay),
    getAttendanceStats(campaignId, startOfDay, endOfDay),
    getQueueStats(campaignId, startOfDay, endOfDay),
    getFinancialStats(campaignId, startOfDay, endOfDay),
  ]);
  
  return {
    date: date.toISOString().split('T')[0],
    campaignId,
    bookings,
    vaccinations,
    attendance,
    queue,
    financial,
  };
}
```

### 4.2 Vaccination Coverage Report

```typescript
interface CoverageReport {
  campaignId: number;
  generatedAt: Date;
  
  overall: {
    targetVaccinations: number;
    completedVaccinations: number;
    coveragePercentage: number;
  };
  
  byDivision: Array<{
    division: string;
    bookings: number;
    vaccinations: number;
    coveragePercentage: number;
  }>;
  
  byBreed: Array<{
    breedId: number | null;
    breedName: string;
    count: number;
    percentage: number;
  }>;
  
  byGender: {
    male: number;
    female: number;
    unknown: number;
  };
  
  byAgeGroup: Array<{
    ageGroup: string;
    range: { min: number; max: number };
    count: number;
  }>;
}

async function generateCoverageReport(campaignId: number): Promise<CoverageReport> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });
  
  const vaccinations = await prisma.campaignPet.findMany({
    where: {
      booking: { campaignId },
      vaccinationStatus: 'COMPLETED',
    },
    include: {
      booking: true,
    },
  });
  
  // Group by division
  const byDivision = await prisma.$queryRaw<Array<{
    division: string;
    bookings: bigint;
    vaccinations: bigint;
  }>>`
    SELECT 
      cb.owner_division as division,
      COUNT(DISTINCT cb.id) as bookings,
      COUNT(CASE WHEN cp.vaccination_status = 'COMPLETED' THEN 1 END) as vaccinations
    FROM campaign_bookings cb
    LEFT JOIN campaign_pets cp ON cp.campaign_booking_id = cb.id
    WHERE cb.campaign_id = ${campaignId}
    GROUP BY cb.owner_division
  `;
  
  // ... other aggregations
  
  return {
    campaignId,
    generatedAt: new Date(),
    overall: {
      targetVaccinations: campaign!.targetVaccinations,
      completedVaccinations: vaccinations.length,
      coveragePercentage: (vaccinations.length / campaign!.targetVaccinations) * 100,
    },
    byDivision: byDivision.map((d) => ({
      division: d.division || 'Unknown',
      bookings: Number(d.bookings),
      vaccinations: Number(d.vaccinations),
      coveragePercentage: Number(d.vaccinations) / Number(d.bookings) * 100,
    })),
    // ... rest of the report
  } as CoverageReport;
}
```

### 4.3 Financial Report

```typescript
interface FinancialReport {
  campaignId: number;
  period: { start: Date; end: Date };
  
  summary: {
    totalRevenue: number;
    totalRefunds: number;
    netRevenue: number;
    averageTicketSize: number;
  };
  
  byPaymentMethod: Array<{
    method: string;
    count: number;
    amount: number;
    percentage: number;
  }>;
  
  byPaymentStatus: {
    completed: { count: number; amount: number };
    pending: { count: number; amount: number };
    failed: { count: number; amount: number };
    refunded: { count: number; amount: number };
  };
  
  dailyTrend: Array<{
    date: string;
    revenue: number;
    transactions: number;
  }>;
  
  refunds: Array<{
    bookingRef: string;
    amount: number;
    reason: string;
    date: Date;
  }>;
}

async function generateFinancialReport(
  campaignId: number,
  startDate: Date,
  endDate: Date
): Promise<FinancialReport> {
  // Get all orders for campaign bookings
  const orders = await prisma.order.findMany({
    where: {
      campaignBooking: { campaignId },
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      payments: true,
    },
  });
  
  const completedPayments = orders
    .flatMap((o) => o.payments)
    .filter((p) => p.status === 'SUCCESS');
  
  const totalRevenue = completedPayments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
  
  // Group by payment method
  const byMethod = completedPayments.reduce((acc, p) => {
    const method = p.gateway;
    if (!acc[method]) {
      acc[method] = { count: 0, amount: 0 };
    }
    acc[method].count++;
    acc[method].amount += p.amount.toNumber();
    return acc;
  }, {} as Record<string, { count: number; amount: number }>);
  
  return {
    campaignId,
    period: { start: startDate, end: endDate },
    summary: {
      totalRevenue,
      totalRefunds: 0, // Calculate from refund records
      netRevenue: totalRevenue,
      averageTicketSize: totalRevenue / orders.length,
    },
    byPaymentMethod: Object.entries(byMethod).map(([method, data]) => ({
      method,
      count: data.count,
      amount: data.amount,
      percentage: (data.amount / totalRevenue) * 100,
    })),
    // ... rest
  } as FinancialReport;
}
```

---

## 5. Export Formats

### 5.1 Excel Export

```typescript
import ExcelJS from 'exceljs';

async function exportToExcel(report: DailySummaryReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BPA Campaign System';
  workbook.created = new Date();
  
  // Summary Sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 },
  ];
  
  summarySheet.addRows([
    { metric: 'Report Date', value: report.date },
    { metric: 'Total Bookings', value: report.bookings.total },
    { metric: 'New Bookings', value: report.bookings.new },
    { metric: 'Total Vaccinations', value: report.vaccinations.total },
    { metric: 'Show Rate', value: `${report.attendance.showRate.toFixed(1)}%` },
    { metric: 'Average Wait Time', value: `${report.queue.avgWaitTime} min` },
    { metric: 'Total Revenue', value: `৳${report.financial.totalRevenue.toLocaleString()}` },
  ]);
  
  // Style header row
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '4472C4' },
  };
  summarySheet.getRow(1).font = { color: { argb: 'FFFFFF' }, bold: true };
  
  // Vaccinations by Location Sheet
  const locationSheet = workbook.addWorksheet('By Location');
  locationSheet.columns = [
    { header: 'Location', key: 'name', width: 30 },
    { header: 'Vaccinations', key: 'count', width: 15 },
  ];
  
  report.vaccinations.byLocation.forEach((loc) => {
    locationSheet.addRow({ name: loc.locationName, count: loc.count });
  });
  
  // Return as buffer
  return await workbook.xlsx.writeBuffer() as Buffer;
}
```

### 5.2 PDF Export

```typescript
import PDFDocument from 'pdfkit';

async function exportToPdf(report: DailySummaryReport): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50 });
    
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    
    // Header
    doc.fontSize(20).text('Daily Campaign Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Date: ${report.date}`, { align: 'center' });
    doc.moveDown(2);
    
    // Summary Section
    doc.fontSize(14).text('Summary', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Total Bookings: ${report.bookings.total}`);
    doc.text(`Total Vaccinations: ${report.vaccinations.total}`);
    doc.text(`Show Rate: ${report.attendance.showRate.toFixed(1)}%`);
    doc.text(`Average Wait Time: ${report.queue.avgWaitTime} minutes`);
    doc.text(`Total Revenue: ৳${report.financial.totalRevenue.toLocaleString()}`);
    doc.moveDown(2);
    
    // By Location Table
    doc.fontSize(14).text('Vaccinations by Location', { underline: true });
    doc.moveDown(0.5);
    
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = [200, 100];
    
    // Table header
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Location', tableLeft, tableTop);
    doc.text('Count', tableLeft + colWidths[0], tableTop);
    
    doc.font('Helvetica');
    let y = tableTop + 20;
    
    report.vaccinations.byLocation.forEach((loc) => {
      doc.text(loc.locationName, tableLeft, y);
      doc.text(loc.count.toString(), tableLeft + colWidths[0], y);
      y += 15;
    });
    
    // Footer
    doc.fontSize(8).text(
      `Generated: ${new Date().toISOString()}`,
      50,
      doc.page.height - 50,
      { align: 'center' }
    );
    
    doc.end();
  });
}
```

### 5.3 CSV Export

```typescript
import { stringify } from 'csv-stringify/sync';

function exportToCsv(data: Array<Record<string, unknown>>, columns: string[]): string {
  return stringify(data, {
    header: true,
    columns,
    bom: true, // UTF-8 BOM for Excel compatibility
  });
}

// Usage
const csvData = report.vaccinations.byLocation.map((loc) => ({
  location: loc.locationName,
  vaccinations: loc.count,
}));

const csv = exportToCsv(csvData, ['location', 'vaccinations']);
```

---

## 6. API Endpoints

### 6.1 Dashboard API

```typescript
// GET /api/v1/campaign-admin/:campaignId/dashboard
router.get('/campaign-admin/:campaignId/dashboard', 
  authenticateStaff,
  requirePermission(CampaignPermission.VIEW_REPORTS),
  async (req, res) => {
    const { campaignId } = req.params;
    
    const [
      overview,
      todayProgress,
      weeklyTrend,
      locationStats,
      vaccineStats,
    ] = await Promise.all([
      getCampaignOverview(parseInt(campaignId)),
      getTodayProgress(parseInt(campaignId)),
      getWeeklyTrend(parseInt(campaignId)),
      getLocationStats(parseInt(campaignId)),
      getVaccineTypeStats(parseInt(campaignId)),
    ]);
    
    res.json({
      overview,
      todayProgress,
      weeklyTrend,
      locationStats,
      vaccineStats,
      generatedAt: new Date().toISOString(),
    });
  }
);
```

### 6.2 Report Generation API

```typescript
// GET /api/v1/campaign-admin/:campaignId/reports/daily?date=2026-07-15
router.get('/campaign-admin/:campaignId/reports/daily',
  authenticateStaff,
  requirePermission(CampaignPermission.VIEW_REPORTS),
  async (req, res) => {
    const { campaignId } = req.params;
    const { date } = req.query;
    
    const reportDate = date ? new Date(date as string) : new Date();
    const report = await generateDailySummary(parseInt(campaignId), reportDate);
    
    res.json(report);
  }
);

// GET /api/v1/campaign-admin/:campaignId/reports/coverage
router.get('/campaign-admin/:campaignId/reports/coverage',
  authenticateStaff,
  requirePermission(CampaignPermission.VIEW_REPORTS),
  async (req, res) => {
    const { campaignId } = req.params;
    const report = await generateCoverageReport(parseInt(campaignId));
    
    res.json(report);
  }
);

// GET /api/v1/campaign-admin/:campaignId/reports/financial?start=...&end=...
router.get('/campaign-admin/:campaignId/reports/financial',
  authenticateStaff,
  requirePermission(CampaignPermission.VIEW_REPORTS),
  async (req, res) => {
    const { campaignId } = req.params;
    const { start, end } = req.query;
    
    const startDate = new Date(start as string);
    const endDate = new Date(end as string);
    
    const report = await generateFinancialReport(
      parseInt(campaignId),
      startDate,
      endDate
    );
    
    res.json(report);
  }
);
```

### 6.3 Export API

```typescript
// GET /api/v1/campaign-admin/:campaignId/reports/daily/export?date=...&format=excel
router.get('/campaign-admin/:campaignId/reports/daily/export',
  authenticateStaff,
  requirePermission(CampaignPermission.EXPORT_DATA),
  async (req, res) => {
    const { campaignId } = req.params;
    const { date, format } = req.query;
    
    const reportDate = date ? new Date(date as string) : new Date();
    const report = await generateDailySummary(parseInt(campaignId), reportDate);
    
    // Log export for audit
    await logAudit({
      campaignId: parseInt(campaignId),
      actorUserId: req.staff.userId,
      actorRole: 'STAFF',
      actorIp: req.ip,
      action: 'REPORT_EXPORTED',
      entityType: 'Report',
      entityId: null,
      beforeJson: null,
      afterJson: { reportType: 'daily', date: reportDate.toISOString() },
      metadataJson: { format },
    });
    
    switch (format) {
      case 'excel':
        const excelBuffer = await exportToExcel(report);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="daily-report-${date}.xlsx"`);
        res.send(excelBuffer);
        break;
        
      case 'pdf':
        const pdfBuffer = await exportToPdf(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="daily-report-${date}.pdf"`);
        res.send(pdfBuffer);
        break;
        
      case 'csv':
        const csvData = exportReportToCsv(report);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="daily-report-${date}.csv"`);
        res.send(csvData);
        break;
        
      default:
        res.status(400).json({ error: 'INVALID_FORMAT', message: 'Supported: excel, pdf, csv' });
    }
  }
);
```

---

## 7. Scheduled Reports

### 7.1 Scheduled Report Configuration

```typescript
// Scheduled via BullMQ repeatable jobs
import { Queue, Worker } from 'bullmq';

const reportQueue = new Queue('campaign-reports', { connection: redis });

// Schedule daily summary email
await reportQueue.add(
  'daily-summary-email',
  { campaignId: 1 },
  {
    repeat: {
      pattern: '0 20 * * *', // 8 PM daily
    },
  }
);

// Worker to process scheduled reports
const reportWorker = new Worker('campaign-reports', async (job) => {
  const { campaignId } = job.data;
  
  switch (job.name) {
    case 'daily-summary-email':
      const report = await generateDailySummary(campaignId, new Date());
      const recipients = await getCampaignAdminEmails(campaignId);
      
      await sendReportEmail(recipients, {
        subject: `[BPA Campaign] Daily Summary - ${report.date}`,
        template: 'daily-summary',
        data: report,
      });
      break;
  }
}, { connection: redis });
```

### 7.2 Report Email Template

```html
<!-- email/daily-summary.hbs -->
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h1 style="color: #2563eb;">Daily Campaign Summary</h1>
  <p>Report for: {{date}}</p>
  
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr style="background: #f3f4f6;">
      <td style="padding: 10px; border: 1px solid #e5e7eb;">Bookings</td>
      <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;">{{bookings.total}}</td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #e5e7eb;">Vaccinations</td>
      <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;">{{vaccinations.total}}</td>
    </tr>
    <tr style="background: #f3f4f6;">
      <td style="padding: 10px; border: 1px solid #e5e7eb;">Show Rate</td>
      <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;">{{formatPercent attendance.showRate}}</td>
    </tr>
    <tr>
      <td style="padding: 10px; border: 1px solid #e5e7eb;">Revenue</td>
      <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: right;">৳{{formatNumber financial.totalRevenue}}</td>
    </tr>
  </table>
  
  <p>
    <a href="{{dashboardUrl}}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
      View Dashboard
    </a>
  </p>
  
  <p style="color: #6b7280; font-size: 12px;">
    This is an automated report from BPA Vaccination Campaign System.
  </p>
</body>
</html>
```

---

## 8. Real-Time Updates

### 8.1 WebSocket for Live Dashboard

```typescript
import { Server } from 'socket.io';

const io = new Server(httpServer, {
  cors: {
    origin: ['https://admin.bpa.com.bd'],
    credentials: true,
  },
});

// Campaign dashboard room
io.on('connection', (socket) => {
  socket.on('join-dashboard', async ({ campaignId, token }) => {
    // Verify staff token
    try {
      const staff = verifyStaffToken(token);
      if (!staff.campaignAssignments.some((a) => a.campaignId === campaignId)) {
        socket.emit('error', { message: 'Not authorized for this campaign' });
        return;
      }
      
      socket.join(`campaign:${campaignId}`);
      
      // Send initial stats
      const stats = await getCampaignDashboardStats(campaignId);
      socket.emit('dashboard-update', stats);
    } catch {
      socket.emit('error', { message: 'Authentication failed' });
    }
  });
});

// Broadcast updates when events occur
async function broadcastDashboardUpdate(campaignId: number) {
  const stats = await getCampaignDashboardStats(campaignId);
  io.to(`campaign:${campaignId}`).emit('dashboard-update', stats);
}

// Call after relevant events
export async function onVaccinationRecorded(campaignId: number) {
  await broadcastDashboardUpdate(campaignId);
}

export async function onCheckIn(campaignId: number) {
  await broadcastDashboardUpdate(campaignId);
}
```
