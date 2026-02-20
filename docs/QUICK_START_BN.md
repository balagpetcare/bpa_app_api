# Quick Start Guide - Branch Access System (বাংলা)

## দ্রুত শুরু করুন

### Step 1: Migration Run করুন

```bash
cd D:\BPA_Data\backend-api

# সব একসাথে
npm run migrate:branch-access

# অথবা step by step
npx prisma generate
npx prisma migrate deploy
npm run backfill:branch-access
```

### Step 2: Frontend-এ Integration করুন

#### Login Response Check করুন

```javascript
// Login করার পর
const loginResponse = await login(email, password);

// Branch access status check করুন
const branches = loginResponse.user.branches || [];
const approvedBranches = branches.filter(b => b.accessStatus === 'APPROVED');

if (approvedBranches.length === 0) {
  // সব branches PENDING - manager approval অপেক্ষা
  showPendingApprovalMessage();
} else {
  // Approved branches আছে - কাজ করতে পারবে
  showBranchSelector(approvedBranches);
}
```

#### Branch Access Check করুন

```javascript
// Branch access করার আগে
const hasAccess = await checkBranchAccess(branchId);

if (!hasAccess) {
  alert('এই branch-এ access নেই। Manager approval প্রয়োজন।');
  return;
}

// Access আছে - কাজ করতে পারবে
proceedToBranch(branchId);
```

### Step 3: Manager Dashboard

Manager dashboard-এ:
- Pending requests দেখতে পারবে
- Approve/Revoke করতে পারবে
- Expiration date set করতে পারবে

## API Endpoints Summary

### Staff
- `POST /api/v1/branch-access/request` - Access request করুন
- `GET /api/v1/branch-access/my-requests` - সব requests দেখুন
- `GET /api/v1/branch-access/active` - Active permissions দেখুন
- `GET /api/v1/branch-access/check/:branchId` - Access check করুন

### Manager
- `GET /api/v1/branch-access/pending` - Pending requests দেখুন
- `POST /api/v1/branch-access/:id/approve` - Approve করুন
- `POST /api/v1/branch-access/:id/revoke` - Revoke করুন
- `GET /api/v1/branch-access/branch/:branchId` - Branch permissions দেখুন

## Important Notes

1. ✅ Login response-এ automatically access status আসে
2. ✅ `accessStatus === 'APPROVED'` হলে কাজ করতে পারবেন
3. ✅ `accessStatus === 'PENDING'` হলে manager approval অপেক্ষা করুন
4. ✅ Branch access করার আগে always `check/:branchId` call করুন
5. ✅ Expiration date check করুন যদি `accessExpiresAt` থাকে

## Complete Documentation

সম্পূর্ণ documentation দেখুন:
- `BRANCH_ACCESS_SYSTEM_BN.md` - Complete system guide
- `FRONTEND_BRANCH_ACCESS_BN.md` - Frontend integration guide
- `FRONTEND_BRANCH_ACCESS_API.md` - API documentation
