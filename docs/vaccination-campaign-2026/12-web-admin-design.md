# Web Admin Design Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

The Campaign Admin Portal enables BPA administrators to create, manage, and monitor vaccination campaigns. This extends the existing BPA web admin (`bpa_web`) with campaign-specific features.

---

## 2. Admin Portal Structure

### 2.1 Navigation

```
BPA Admin Panel
├── Dashboard
├── Campaigns (NEW)
│   ├── All Campaigns
│   ├── Create Campaign
│   └── [Campaign Detail]
│       ├── Overview
│       ├── Locations
│       ├── Slots
│       ├── Bookings
│       ├── Vaccinations
│       ├── Staff
│       ├── SMS Templates
│       ├── Reports
│       └── Settings
├── Existing Modules...
└── Settings
```

### 2.2 Technology Stack

- **Framework**: Next.js 16 (existing bpa_web)
- **UI Components**: React Bootstrap + Tailwind CSS
- **State**: React Query for server state
- **Forms**: React Hook Form + Zod
- **Tables**: TanStack Table
- **Charts**: Recharts / ApexCharts

---

## 3. Page Designs

### 3.1 Campaign List Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Campaigns                                              [+ Create Campaign] │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Active] [Draft] [Completed] [All]          🔍 Search campaigns...        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 2026 Cat Flu + Rabies Campaign                          [ACTIVE] ✓  │   │
│  │ Jul 1, 2026 - Aug 31, 2026 • 5 locations • Free                     │   │
│  │ Bookings: 1,234 • Vaccinations: 987 • Today: 45                     │   │
│  │ [View] [Edit] [Reports]                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 2025 Rabies Awareness Campaign                        [COMPLETED]   │   │
│  │ Oct 1, 2025 - Oct 31, 2025 • 3 locations • ৳200                     │   │
│  │ Bookings: 2,456 • Vaccinations: 2,123 • Archived                    │   │
│  │ [View] [Reports]                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Create Campaign Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Create New Campaign                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 1 OF 4: Basic Information                                            │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  Campaign Name *                                                            │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 2026 Cat Flu + Rabies Vaccination Campaign                            │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  URL Slug *                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ cat-flu-rabies-2026                                                   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│  vacc.bpa.com.bd/campaigns/cat-flu-rabies-2026                            │
│                                                                             │
│  Description                                                                │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Free vaccination campaign for cats against Rabies and Cat Flu...      │ │
│  │                                                                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Campaign Period *                                                          │
│  ┌─────────────────────┐    ┌─────────────────────┐                        │
│  │ Jul 1, 2026      📅 │    │ Aug 31, 2026     📅 │                        │
│  └─────────────────────┘    └─────────────────────┘                        │
│  Start Date                  End Date                                       │
│                                                                             │
│  Pricing *                                                                  │
│  ( • ) Free   ( ) Paid   ( ) Donation-based                                │
│                                                                             │
│  ┌─────────────────────┐                                                   │
│  │ ৳ 0                  │  (Visible if Paid selected)                      │
│  └─────────────────────┘                                                   │
│                                                                             │
│                                           [Cancel]  [Next: Locations →]    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Campaign Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  2026 Cat Flu + Rabies Campaign                              [ACTIVE] ●    │
│  Jul 1 - Aug 31, 2026                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │     1,234        │  │       987        │  │       85%        │          │
│  │    Bookings      │  │   Vaccinations   │  │  Completion Rate │          │
│  │    ↑ 45 today    │  │    ↑ 38 today    │  │                  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │       147        │  │       102        │  │        5         │          │
│  │     No-Shows     │  │     Walk-ins     │  │    Locations     │          │
│  │      12%         │  │       8%         │  │                  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  TODAY'S OVERVIEW                                            Jul 15, 2026  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Location           │ Checked In │ Vaccinated │ Pending │ No-Show   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Dhaka Central      │    25      │     20     │    5    │     3     │   │
│  │ Gulshan            │    18      │     15     │    3    │     2     │   │
│  │ Mirpur             │    12      │     10     │    2    │     1     │   │
│  │ Uttara             │     8      │      6     │    2    │     0     │   │
│  │ Dhanmondi          │    10      │      8     │    2    │     1     │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ TOTAL              │    73      │     59     │   14    │     7     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  BOOKING TREND (Last 14 Days)                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  100 │     ╭─╮                                                      │   │
│  │      │   ╭─╯ ╰─╮    ╭─╮                                             │   │
│  │   50 │ ╭─╯     ╰─╮╭─╯ ╰─╮╭────                                      │   │
│  │      │╭╯        ╰╯     ╰╯                                           │   │
│  │    0 │──────────────────────────────────────                        │   │
│  │      Jul 1  Jul 3  Jul 5  Jul 7  Jul 9  Jul 11  Jul 13  Jul 15     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [View All Bookings]  [Generate Report]  [Campaign Settings]               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Location Management

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Locations                                              [+ Add Location]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Dhaka Central Vet Clinic                                   [Active] │   │
│  │ 123 Main Road, Dhanmondi, Dhaka                                     │   │
│  │ Contact: Dr. Rahman | 01712345678                                   │   │
│  │ Capacity: 100/day | Slots: 09:00-12:00, 14:00-17:00                │   │
│  │ Today: 45 booked, 30 vaccinated                                     │   │
│  │ [Edit] [Manage Slots] [View Queue] [Deactivate]                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Gulshan Pet Hospital                                       [Active] │   │
│  │ 456 Gulshan Avenue, Dhaka                                           │   │
│  │ Contact: Dr. Haque | 01812345678                                    │   │
│  │ Capacity: 80/day | Slots: 10:00-13:00, 15:00-18:00                 │   │
│  │ Today: 38 booked, 25 vaccinated                                     │   │
│  │ [Edit] [Manage Slots] [View Queue] [Deactivate]                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 Bookings List

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Bookings                                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Filters:                                                                   │
│  Status: [All ▾]  Location: [All ▾]  Date: [Jul 15, 2026 📅]              │
│  🔍 Search by phone, name, or booking ref...                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Ref        │ Owner           │ Phone       │ Pets │ Status    │ ▶ │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ VAC-ABC123 │ John Doe        │ 01712***678 │ 2    │ ✓ CHECKED │ ⋮ │   │
│  │ VAC-XYZ789 │ Jane Smith      │ 01812***432 │ 1    │ ● CONFIRM │ ⋮ │   │
│  │ VAC-DEF456 │ Ahmed Khan      │ 01912***876 │ 3    │ ✗ NO_SHOW │ ⋮ │   │
│  │ VAC-GHI012 │ Fatima Begum    │ 01612***234 │ 1    │ ✓ COMPLET │ ⋮ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Showing 1-20 of 1,234 bookings                    [< 1 2 3 ... 62 >]      │
│                                                                             │
│  [Export CSV]                                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Component Implementation

### 4.1 Campaign Form

```tsx
// components/admin/campaigns/CampaignForm.tsx

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const campaignSchema = z.object({
  name: z.string().min(3).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(100),
  description: z.string().max(2000).optional(),
  startDate: z.string(),
  endDate: z.string(),
  pricingType: z.enum(['FREE', 'PAID', 'DONATION']),
  priceAmount: z.number().min(0).optional(),
  maxPetsPerBooking: z.number().min(1).max(10).default(5),
  minAdvanceHours: z.number().min(0).max(168).default(24),
  allowWalkIns: z.boolean().default(true),
  walkInQuotaPercent: z.number().min(0).max(100).default(20),
  vaccineTypeIds: z.array(z.number()).min(1),
});

type CampaignFormData = z.infer<typeof campaignSchema>;

export function CampaignForm({ 
  initialData, 
  onSubmit 
}: { 
  initialData?: Partial<CampaignFormData>;
  onSubmit: (data: CampaignFormData) => Promise<void>;
}) {
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<CampaignFormData>({
    resolver: zodResolver(campaignSchema),
    defaultValues: initialData,
  });
  
  const pricingType = watch('pricingType');
  
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Campaign Name */}
      <div>
        <label className="block text-sm font-medium mb-1">Campaign Name *</label>
        <input
          {...register('name')}
          className="w-full px-3 py-2 border rounded-lg"
          placeholder="e.g., 2026 Cat Flu + Rabies Campaign"
        />
        {errors.name && (
          <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>
        )}
      </div>
      
      {/* URL Slug */}
      <div>
        <label className="block text-sm font-medium mb-1">URL Slug *</label>
        <div className="flex items-center">
          <span className="text-gray-500 text-sm mr-2">vacc.bpa.com.bd/campaigns/</span>
          <input
            {...register('slug')}
            className="flex-1 px-3 py-2 border rounded-lg"
            placeholder="cat-flu-rabies-2026"
          />
        </div>
        {errors.slug && (
          <p className="text-red-500 text-sm mt-1">{errors.slug.message}</p>
        )}
      </div>
      
      {/* Date Range */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Start Date *</label>
          <input
            type="date"
            {...register('startDate')}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">End Date *</label>
          <input
            type="date"
            {...register('endDate')}
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
      </div>
      
      {/* Pricing */}
      <div>
        <label className="block text-sm font-medium mb-2">Pricing *</label>
        <div className="flex gap-4">
          <label className="flex items-center">
            <input
              type="radio"
              {...register('pricingType')}
              value="FREE"
              className="mr-2"
            />
            Free
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              {...register('pricingType')}
              value="PAID"
              className="mr-2"
            />
            Paid
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              {...register('pricingType')}
              value="DONATION"
              className="mr-2"
            />
            Donation-based
          </label>
        </div>
        
        {pricingType === 'PAID' && (
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">Price (BDT)</label>
            <input
              type="number"
              {...register('priceAmount', { valueAsNumber: true })}
              className="w-40 px-3 py-2 border rounded-lg"
              placeholder="500"
            />
          </div>
        )}
      </div>
      
      {/* Vaccine Types */}
      <VaccineTypeSelector register={register} errors={errors} />
      
      {/* Settings */}
      <div className="border-t pt-6">
        <h3 className="font-medium mb-4">Campaign Settings</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Max Pets per Booking</label>
            <input
              type="number"
              {...register('maxPetsPerBooking', { valueAsNumber: true })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Min Advance Booking (hours)</label>
            <input
              type="number"
              {...register('minAdvanceHours', { valueAsNumber: true })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
        
        <div className="mt-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              {...register('allowWalkIns')}
              className="mr-2"
            />
            Allow walk-in registrations
          </label>
          
          {watch('allowWalkIns') && (
            <div className="mt-2 ml-6">
              <label className="block text-sm text-gray-600 mb-1">
                Walk-in quota (% of capacity)
              </label>
              <input
                type="number"
                {...register('walkInQuotaPercent', { valueAsNumber: true })}
                className="w-24 px-3 py-2 border rounded-lg"
              />
            </div>
          )}
        </div>
      </div>
      
      {/* Submit */}
      <div className="flex justify-end gap-3 border-t pt-6">
        <button type="button" className="px-4 py-2 border rounded-lg">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : 'Save Campaign'}
        </button>
      </div>
    </form>
  );
}
```

### 4.2 Dashboard Stats

```tsx
// components/admin/campaigns/CampaignStats.tsx

interface CampaignStats {
  totalBookings: number;
  totalVaccinations: number;
  completionRate: number;
  noShows: number;
  walkIns: number;
  todayStats: {
    bookings: number;
    checkedIn: number;
    vaccinated: number;
    pending: number;
  };
}

export function CampaignDashboard({ campaignId }: { campaignId: number }) {
  const { data: stats, isLoading } = useQuery(
    ['campaign-stats', campaignId],
    () => fetchCampaignStats(campaignId),
    { refetchInterval: 30000 } // Refresh every 30 seconds
  );
  
  if (isLoading) return <StatsLoading />;
  
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Total Bookings"
          value={stats.totalBookings}
          subtext={`↑ ${stats.todayStats.bookings} today`}
          icon={<CalendarIcon />}
        />
        <StatCard
          title="Vaccinations"
          value={stats.totalVaccinations}
          subtext={`↑ ${stats.todayStats.vaccinated} today`}
          icon={<SyringeIcon />}
        />
        <StatCard
          title="Completion Rate"
          value={`${stats.completionRate}%`}
          icon={<CheckCircleIcon />}
        />
        <StatCard
          title="No-Shows"
          value={stats.noShows}
          subtext={`${Math.round(stats.noShows / stats.totalBookings * 100)}%`}
          icon={<XCircleIcon />}
          variant="warning"
        />
        <StatCard
          title="Walk-ins"
          value={stats.walkIns}
          subtext={`${Math.round(stats.walkIns / stats.totalBookings * 100)}%`}
          icon={<WalkIcon />}
        />
      </div>
      
      {/* Today's Overview */}
      <TodayOverview stats={stats.todayStats} />
      
      {/* Booking Trend Chart */}
      <BookingTrendChart campaignId={campaignId} />
      
      {/* Location Breakdown */}
      <LocationBreakdown campaignId={campaignId} />
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  subtext, 
  icon, 
  variant = 'default' 
}: StatCardProps) {
  const bgColor = variant === 'warning' ? 'bg-amber-50' : 'bg-white';
  
  return (
    <div className={`${bgColor} rounded-lg shadow p-4`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {subtext && (
            <p className="text-xs text-gray-400 mt-1">{subtext}</p>
          )}
        </div>
        <div className="text-gray-400">{icon}</div>
      </div>
    </div>
  );
}
```

### 4.3 Bookings Table

```tsx
// components/admin/campaigns/BookingsTable.tsx

import { createColumnHelper, useReactTable, getCoreRowModel } from '@tanstack/react-table';

interface Booking {
  id: number;
  bookingRef: string;
  ownerName: string;
  ownerPhone: string;
  petCount: number;
  status: BookingStatus;
  bookingDate: string;
  location: { name: string };
}

const columnHelper = createColumnHelper<Booking>();

const columns = [
  columnHelper.accessor('bookingRef', {
    header: 'Reference',
    cell: (info) => (
      <span className="font-mono text-sm">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('ownerName', {
    header: 'Owner',
  }),
  columnHelper.accessor('ownerPhone', {
    header: 'Phone',
    cell: (info) => maskPhone(info.getValue()),
  }),
  columnHelper.accessor('petCount', {
    header: 'Pets',
    cell: (info) => <span className="text-center">{info.getValue()}</span>,
  }),
  columnHelper.accessor('location.name', {
    header: 'Location',
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <BookingStatusBadge status={info.getValue()} />,
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: ({ row }) => <BookingActions booking={row.original} />,
  }),
];

export function BookingsTable({ campaignId }: { campaignId: number }) {
  const [filters, setFilters] = useState<BookingFilters>({});
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 });
  
  const { data, isLoading } = useQuery(
    ['campaign-bookings', campaignId, filters, pagination],
    () => fetchCampaignBookings(campaignId, filters, pagination)
  );
  
  const table = useReactTable({
    data: data?.bookings || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: data?.pageCount || 0,
    state: { pagination },
    onPaginationChange: setPagination,
  });
  
  return (
    <div className="space-y-4">
      {/* Filters */}
      <BookingFilters filters={filters} onChange={setFilters} />
      
      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-sm font-medium text-gray-500"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <TableLoading columns={columns.length} />
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
        
        {/* Pagination */}
        <TablePagination table={table} totalCount={data?.totalCount || 0} />
      </div>
      
      {/* Export */}
      <div className="flex justify-end">
        <button
          onClick={() => exportBookings(campaignId, filters)}
          className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}

function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const styles = {
    CONFIRMED: 'bg-blue-100 text-blue-700',
    CHECKED_IN: 'bg-green-100 text-green-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    NO_SHOW: 'bg-red-100 text-red-700',
    CANCELLED: 'bg-gray-100 text-gray-700',
  };
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
```

---

## 5. Reports Page

### 5.1 Report Generation

```tsx
// pages/admin/campaigns/[id]/reports.tsx

export default function CampaignReportsPage() {
  const { campaignId } = useParams();
  const [reportType, setReportType] = useState<ReportType>('summary');
  const [dateRange, setDateRange] = useState<DateRange>(last7Days());
  
  const { data: report, isLoading, refetch } = useQuery(
    ['campaign-report', campaignId, reportType, dateRange],
    () => generateReport(campaignId, reportType, dateRange),
    { enabled: false }
  );
  
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Campaign Reports</h1>
      
      {/* Report Type Selection */}
      <div className="flex gap-2">
        {REPORT_TYPES.map((type) => (
          <button
            key={type.id}
            onClick={() => setReportType(type.id)}
            className={`px-4 py-2 rounded-lg ${
              reportType === type.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>
      
      {/* Date Range */}
      <DateRangePicker value={dateRange} onChange={setDateRange} />
      
      {/* Generate Button */}
      <button
        onClick={() => refetch()}
        disabled={isLoading}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg"
      >
        {isLoading ? 'Generating...' : 'Generate Report'}
      </button>
      
      {/* Report Display */}
      {report && <ReportDisplay report={report} type={reportType} />}
      
      {/* Export Options */}
      {report && (
        <div className="flex gap-3">
          <button
            onClick={() => downloadReport(report, 'csv')}
            className="px-4 py-2 border rounded-lg"
          >
            Download CSV
          </button>
          <button
            onClick={() => downloadReport(report, 'pdf')}
            className="px-4 py-2 border rounded-lg"
          >
            Download PDF
          </button>
        </div>
      )}
    </div>
  );
}

const REPORT_TYPES = [
  { id: 'summary', label: 'Summary' },
  { id: 'daily', label: 'Daily Breakdown' },
  { id: 'location', label: 'By Location' },
  { id: 'vaccine', label: 'Vaccine Usage' },
  { id: 'demographics', label: 'Demographics' },
  { id: 'staff', label: 'Staff Activity' },
];
```

---

## 6. Permissions

### 6.1 Admin Roles

| Role | Permissions |
|------|-------------|
| Super Admin | Full access to all campaigns |
| Campaign Admin | Full access to assigned campaigns |
| Campaign Manager | View + Edit assigned campaigns |
| Report Viewer | View-only access to reports |

### 6.2 Permission Checks

```typescript
// middleware/campaignAuth.ts

export function requireCampaignPermission(permission: CampaignPermission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const campaignId = parseInt(req.params.campaignId);
    
    // Super admin bypass
    if (user.isSuperAdmin) {
      return next();
    }
    
    // Check campaign-specific permission
    const hasPermission = await checkCampaignPermission(
      user.id,
      campaignId,
      permission
    );
    
    if (!hasPermission) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
    }
    
    next();
  };
}
```
