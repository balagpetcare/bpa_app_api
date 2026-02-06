# Staff Access Waiting Flow - সম্পূর্ণ গাইড (বাংলা)

## Overview

যখন একজন staff member (manager ছাড়া) login করে এবং `/staff/branch/1` access করতে চায়, তখন system automatically check করবে তার branch access permission আছে কিনা। যদি permission না থাকে বা PENDING থাকে, তাহলে তাকে auto-logout না করে একটি waiting page দেখাবে।

## Flow Diagram

```
Staff Login
    ↓
Check Branch Access
    ↓
Has APPROVED Access?
    ├─ YES → Show Branch Dashboard ✅
    └─ NO → Show Waiting Page ⏳
            ↓
        Manager Dashboard
            ↓
        Manager Approves/Declines
            ↓
        Staff Gets Notification
            ↓
        Auto-Redirect to Dashboard ✅
```

## Implementation Details

### 1. Staff Branch Page Access Check

**File**: `app/staff/branch/[branchId]/page.jsx`

এই page-এ access check করা হয়:

```javascript
// First check branch access
const accessCheck = await apiGet(`/api/v1/branch-access/check/${branchId}`);
const hasAccess = accessCheck?.data?.hasAccess;

if (!hasAccess) {
  // Get detailed status
  const permission = // ... get permission details

  if (permission.status !== "APPROVED") {
    // Redirect to waiting page
    router.push(`/staff/branch/${branchId}/waiting`);
    return;
  }
}
```

### 2. Waiting Page

**File**: `app/staff/branch/[branchId]/waiting/page.jsx`

এই page দেখায়:
- "অনুগ্রহ করে অপেক্ষা করুন" message
- Branch name
- Current status (PENDING, REVOKED, EXPIRED)
- Auto-refresh button
- "Branches-এ ফিরে যান" button
- Auto-check every 10 seconds

### 3. Branch Selector Update

**File**: `app/staff/branches/page.jsx`

Branch selector-এ access status দেখায়:
- ✅ Approved branches - "Enter Branch" button
- ⏳ Pending branches - "Waiting for Approval" button (disabled)
- ❌ Revoked/Expired - Appropriate message

### 4. Manager Dashboard - Approval Section

**File**: `app/owner/_components/branch/StaffAccessApprovals.jsx`

Manager dashboard-এ (`/owner/branches/[id]`) একটি নতুন section যোগ করা হয়েছে:

- **Title**: "Staff Access Approvals"
- **Shows**: Pending requests for this branch
- **Actions**:
  - Approve button (green)
  - Decline/Revoke button (red)
- **Table Columns**:
  - Staff Name
  - Email
  - Role
  - Requested At
  - Actions

## User Experience

### Staff Experience

1. **Login**: Staff login করে
2. **Branch Select**: Branch select করে
3. **Access Check**: System automatically check করে
4. **If PENDING**: Waiting page দেখায়
   - Message: "অনুগ্রহ করে অপেক্ষা করুন"
   - "আবার Check করুন" button
   - Auto-check every 10 seconds
5. **If APPROVED**: Branch dashboard দেখায়

### Manager Experience

1. **Login**: Manager login করে
2. **Dashboard**: Branch dashboard-এ যায় (`/owner/branches/[id]`)
3. **Approval Section**: "Staff Access Approvals" section দেখে
4. **Pending Requests**: Table-এ সব pending requests দেখে
5. **Approve/Decline**: Button click করে action নেয়
6. **Notification**: Staff-কে automatic notification যায়

## API Integration

### Frontend API Calls

1. **Check Access**:
   ```javascript
   GET /api/v1/branch-access/check/:branchId
   ```

2. **Get Pending Requests** (Manager):
   ```javascript
   GET /api/v1/branch-access/pending
   ```

3. **Approve** (Manager):
   ```javascript
   POST /api/v1/branch-access/:id/approve
   Body: { expiresAt?: "2026-12-31T23:59:59Z" }
   ```

4. **Revoke** (Manager):
   ```javascript
   POST /api/v1/branch-access/:id/revoke
   ```

## Auto-Refresh Mechanism

Waiting page-এ auto-refresh mechanism আছে:

1. **Initial Load**: Page load হওয়ার সময় access check করে
2. **Interval Check**: প্রতি ১০ সেকেন্ডে automatically check করে
3. **Manual Refresh**: User "আবার Check করুন" button click করতে পারে
4. **Auto-Redirect**: যদি access APPROVED হয়, automatically dashboard-এ redirect করে

## Status Messages

### Bengali Messages

- **PENDING**: "আপনার request এখনও review-এর অপেক্ষায় আছে"
- **REVOKED**: "আপনার access revoked হয়েছে"
- **EXPIRED**: "আপনার access expire হয়ে গেছে"
- **APPROVED**: "Access আছে - কাজ করতে পারবেন"

## Manager Dashboard Integration

### Location

Manager dashboard-এ approval section যোগ করা হয়েছে:
- **Path**: `/owner/branches/[id]`
- **Component**: `StaffAccessApprovals`
- **Position**: Branch dashboard-এর নিচে

### Features

1. **Real-time Updates**: Table automatically refresh হয়
2. **Filter by Branch**: শুধুমাত্র current branch-এর requests দেখায়
3. **Action Buttons**: Approve এবং Decline buttons
4. **Loading States**: Processing state দেখায়
5. **Empty State**: যদি কোন request না থাকে, message দেখায়

## Testing Checklist

- [ ] Staff login করে branch access করতে পারে
- [ ] PENDING status-এ waiting page দেখায়
- [ ] Waiting page auto-refresh করে
- [ ] Manager dashboard-এ approval section আছে
- [ ] Manager approve করতে পারে
- [ ] Manager decline করতে পারে
- [ ] Staff-কে notification যায়
- [ ] Auto-redirect কাজ করে

## Important Notes

1. ✅ Staff auto-logout হয় না
2. ✅ Waiting page দেখায় manager approval-এর জন্য
3. ✅ Auto-refresh mechanism আছে
4. ✅ Manager dashboard-এ approval section আছে
5. ✅ Real-time updates support আছে

## Troubleshooting

### Issue: Waiting page show হচ্ছে না

**Solution**: Check করুন:
- Access check API call হচ্ছে কিনা
- Router redirect কাজ করছে কিনা
- Permission status correct আছে কিনা

### Issue: Manager dashboard-এ requests দেখাচ্ছে না

**Solution**: Check করুন:
- Manager role correct আছে কিনা
- API endpoint correct আছে কিনা
- Branch ID filter correct আছে কিনা

### Issue: Auto-refresh কাজ করছে না

**Solution**: Check করুন:
- Interval set করা আছে কিনা
- useEffect cleanup correct আছে কিনা
- API call successful হচ্ছে কিনা
