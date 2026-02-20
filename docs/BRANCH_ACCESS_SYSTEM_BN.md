# Multi-Branch Staff Permission System - সম্পূর্ণ গাইড (বাংলা)

## পরিচিতি

এই system-এর মাধ্যমে staff members একাধিক branch-এ কাজ করতে পারবে, কিন্তু প্রতিটি branch-এ কাজ করার জন্য branch manager-এর approval প্রয়োজন হবে। System-এ time-based permissions, email notifications, এবং manager dashboard সবই আছে।

## System Overview

### মূল বৈশিষ্ট্য

1. **Multi-Branch Support**: একজন staff অনেকগুলো branch-এ কাজ করতে পারবে
2. **Manager Approval**: প্রতিটি branch-এ access পাওয়ার জন্য manager approval প্রয়োজন
3. **Time-Based Expiration**: Optional expiration date set করা যায়
4. **Email Notifications**: Manager এবং staff-কে automatic email notification
5. **Auto-Expiration**: Expired permissions automatically update হয়
6. **Grandfathered Access**: Existing members-এর জন্য auto-approved access

## Database Structure

### BranchAccessPermission Model

```prisma
model BranchAccessPermission {
  id              Int                            @id
  branchId        Int                            // কোন branch
  userId          Int                            // কোন staff
  status          BranchAccessPermissionStatus   // PENDING, APPROVED, REVOKED, EXPIRED

  approvedByUserId Int?                         // কে approve করেছে
  approvedAt       DateTime?                     // কখন approve হয়েছে
  revokedByUserId  Int?                         // কে revoke করেছে
  revokedAt        DateTime?                    // কখন revoke হয়েছে
  expiresAt        DateTime?                    // কখন expire হবে (optional)

  requestedAt      DateTime                     // কখন request করা হয়েছে
  lastLoginAt      DateTime?                    // শেষ কখন branch access করেছে
}
```

### Status Types

- **PENDING**: Manager approval অপেক্ষা করছে
- **APPROVED**: Access আছে, কাজ করতে পারবে
- **REVOKED**: Manager access revoke করেছে
- **EXPIRED**: Expiration date পার হয়ে গেছে

## Workflow

### Staff Login Flow

1. Staff login করে
2. System automatically check করে user-এর branch memberships
3. প্রতিটি branch-এর জন্য:
   - যদি permission না থাকে → PENDING request create করে
   - Manager-কে email notification যায়
   - Staff-কে "Waiting for approval" message দেখায়
4. যদি APPROVED থাকে:
   - Expiration check করে
   - যদি expired → EXPIRED status-এ update করে
   - যদি active → Access দেয় এবং lastLoginAt update করে
5. Staff শুধুমাত্র APPROVED status-এর branches access করতে পারবে

### Manager Approval Flow

1. Manager email notification পায়
2. Manager dashboard-এ login করে
3. Pending requests দেখতে পায়
4. Manager করতে পারে:
   - Approve করতে পারে (optional expiration date সহ)
   - Reject/Revoke করতে পারে
   - Staff details এবং history দেখতে পারে
5. System staff-কে notification পাঠায়
6. Staff এখন branch access করতে পারবে

## API Endpoints

### Staff Endpoints

#### 1. Request Branch Access
```
POST /api/v1/branch-access/request
Body: { branchId: number }
```

**Description**: Staff একটি branch-এ access request করে

**Response**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "branchId": 1,
    "userId": 123,
    "status": "PENDING",
    "requestedAt": "2026-01-28T12:00:00Z"
  },
  "message": "Access request submitted. Waiting for manager approval."
}
```

#### 2. Get My Requests
```
GET /api/v1/branch-access/my-requests
```

**Description**: Staff-এর সব permission requests দেখায় (সব status)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "branchId": 1,
      "status": "APPROVED",
      "requestedAt": "2026-01-28T10:00:00Z",
      "approvedAt": "2026-01-28T11:00:00Z",
      "expiresAt": null,
      "branch": {
        "id": 1,
        "name": "Branch A",
        "org": { "id": 1, "name": "Organization Name" }
      }
    }
  ]
}
```

#### 3. Get Active Permissions
```
GET /api/v1/branch-access/active
```

**Description**: শুধুমাত্র APPROVED permissions দেখায়

#### 4. Check Branch Access
```
GET /api/v1/branch-access/check/:branchId
```

**Description**: একটি specific branch-এ access আছে কিনা check করে

**Response**:
```json
{
  "success": true,
  "data": {
    "hasAccess": true,
    "branchId": 1
  }
}
```

### Manager Endpoints

#### 1. Get Pending Requests
```
GET /api/v1/branch-access/pending
```

**Description**: Manager-এর managed branches-এর জন্য সব pending requests দেখায়

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "branchId": 1,
      "userId": 123,
      "status": "PENDING",
      "requestedAt": "2026-01-28T12:00:00Z",
      "user": {
        "id": 123,
        "profile": { "displayName": "Staff Name" },
        "auth": { "email": "staff@example.com" }
      },
      "branch": {
        "id": 1,
        "name": "Branch A"
      }
    }
  ]
}
```

#### 2. Approve Access
```
POST /api/v1/branch-access/:id/approve
Body: { expiresAt?: "2026-12-31T23:59:59Z" }
```

**Description**: একটি permission request approve করে

**Request Body** (Optional):
```json
{
  "expiresAt": "2026-12-31T23:59:59Z"  // Optional expiration date
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "APPROVED",
    "approvedAt": "2026-01-28T13:00:00Z",
    "expiresAt": "2026-12-31T23:59:59Z"
  },
  "message": "Access approved successfully"
}
```

#### 3. Revoke Access
```
POST /api/v1/branch-access/:id/revoke
```

**Description**: একটি permission revoke করে

**Response**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "status": "REVOKED",
    "revokedAt": "2026-01-28T14:00:00Z"
  },
  "message": "Access revoked successfully"
}
```

#### 4. Get Branch Permissions
```
GET /api/v1/branch-access/branch/:branchId
```

**Description**: একটি branch-এর সব permissions দেখায় (সব status)

## Frontend Integration

### Login Response Structure

Staff login করার সময় response-এ automatically branch access information আসে:

```json
{
  "success": true,
  "user": {
    "id": 123,
    "email": "staff@example.com",
    "branches": [
      {
        "id": 1,
        "name": "Branch A",
        "type": "CLINIC",
        "role": "BRANCH_STAFF",
        "accessStatus": "APPROVED",      // ✅ নতুন field
        "accessExpiresAt": null          // ✅ নতুন field
      },
      {
        "id": 2,
        "name": "Branch B",
        "type": "SHOP",
        "role": "BRANCH_STAFF",
        "accessStatus": "PENDING",       // ⏳ Manager approval অপেক্ষা
        "accessExpiresAt": null
      }
    ]
  }
}
```

### Frontend Check Methods

#### Method 1: Login Response থেকে Check

```javascript
function checkAccessFromLogin(loginResponse) {
  const branches = loginResponse.user.branches || [];

  // Approved branches
  const approvedBranches = branches.filter(
    b => b.accessStatus === 'APPROVED'
  );

  // Pending branches
  const pendingBranches = branches.filter(
    b => b.accessStatus === 'PENDING'
  );

  return {
    approved: approvedBranches,
    pending: pendingBranches,
    canAccess: approvedBranches.length > 0
  };
}
```

#### Method 2: API Call দিয়ে Check

```javascript
async function checkBranchAccess(branchId) {
  const token = localStorage.getItem('token');

  const response = await fetch(
    `/api/v1/branch-access/check/${branchId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  const data = await response.json();
  return data.data.hasAccess; // true/false
}
```

### React Hook Example

```typescript
import { useState, useEffect } from 'react';

export function useBranchAccess() {
  const [accessStatus, setAccessStatus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAccessStatus();
  }, []);

  const loadAccessStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/branch-access/my-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setAccessStatus(data.data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const checkAccess = async (branchId: number) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/v1/branch-access/check/${branchId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      return data.data.hasAccess;
    } catch {
      return false;
    }
  };

  return { accessStatus, loading, checkAccess, refresh: loadAccessStatus };
}
```

### Component Example

```tsx
export function BranchAccessStatus() {
  const { accessStatus, loading } = useBranchAccess();

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Branch Access Status</h2>
      {accessStatus.map((access) => (
        <div key={access.id}>
          <h3>{access.branch.name}</h3>

          {access.status === 'APPROVED' && (
            <div>
              ✅ Access Approved
              {access.expiresAt && (
                <p>Expires: {new Date(access.expiresAt).toLocaleDateString()}</p>
              )}
            </div>
          )}

          {access.status === 'PENDING' && (
            <div>⏳ Waiting for Manager Approval</div>
          )}

          {access.status === 'REVOKED' && (
            <div>❌ Access Revoked</div>
          )}

          {access.status === 'EXPIRED' && (
            <div>⚠️ Access Expired</div>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Email Notifications

### Notification Types

1. **STAFF_BRANCH_ACCESS_REQUEST**: Manager-কে staff-এর request notification
2. **STAFF_BRANCH_ACCESS_APPROVED**: Staff-কে approval notification
3. **STAFF_BRANCH_ACCESS_REVOKED**: Staff-কে revocation notification
4. **STAFF_BRANCH_ACCESS_EXPIRED**: Staff-কে expiration notification

### Email Templates

Email templates আছে `src/utils/emailTemplates/` folder-এ:
- `branchAccessRequest.html` - Manager-কে request notification
- `branchAccessApproved.html` - Staff-কে approval notification
- `branchAccessRevoked.html` - Staff-কে revocation notification
- `branchAccessExpiring.html` - Staff-কে expiration warning

## Background Jobs

### Expire Permissions Job

Daily run হয় expired permissions automatically expire করার জন্য:

```typescript
// src/common/jobs/expireBranchPermissions.job.ts
runExpireBranchPermissionsJob()
```

**What it does**:
1. সব APPROVED permissions find করে যাদের expiresAt পার হয়ে গেছে
2. Status EXPIRED-এ update করে
3. Affected staff-দের notification পাঠায়

### Expiration Warnings

3 days before expiration warning পাঠায়:

```typescript
sendExpirationWarnings(3) // 3 days before
```

## Security & Permissions

### Permission Checks

1. **Manager Authorization**: শুধুমাত্র branch manager বা org owner approve/revoke করতে পারবে
2. **Staff Validation**: Staff শুধুমাত্র তাদের own branches-এ request করতে পারবে
3. **Expiration Validation**: Expiration date future-এ হতে হবে
4. **Access Verification**: প্রতিটি branch access-এর আগে permission check হয়

### Permission Resolution

`src/api/v1/utils/permissions.js` file-এ permission resolution logic আছে:

- Branch members-এর জন্য শুধুমাত্র APPROVED permissions-এর জন্য permissions grant হয়
- Owners-এর জন্য implicit access আছে সব org branches-এ
- Expired permissions automatically filter হয়

## Migration & Setup

### Migration Steps

1. **Generate Prisma Client**:
   ```bash
   npx prisma generate
   ```

2. **Apply Migration**:
   ```bash
   npx prisma migrate deploy
   ```

3. **Backfill Existing Members**:
   ```bash
   npx ts-node scripts/backfill-branch-access-permissions.ts
   ```

### Backfill Script

Existing `BranchMember` records-এর জন্য automatically APPROVED permissions create করে:

- Status: APPROVED
- approvedAt: BranchMember.createdAt (grandfathered)
- expiresAt: null (no expiration)

## Use Cases

### Use Case 1: New Staff Joins

1. Staff-কে branch-এ invite করা হয়
2. Staff login করে
3. System automatically PENDING request create করে
4. Manager-কে email notification যায়
5. Manager approve করে
6. Staff access পায়

### Use Case 2: Staff Works at Multiple Branches

1. Staff Branch A-তে কাজ করছে (APPROVED)
2. Staff Branch B-তে কাজ করতে চায়
3. Staff request করে Branch B-এর জন্য
4. Manager approve করে
5. Staff এখন দুই branch-এ কাজ করতে পারবে

### Use Case 3: Temporary Access

1. Staff-কে temporary access দরকার (e.g., 1 month)
2. Manager approve করে expiration date সহ
3. 1 month পরে automatically expire হয়
4. Staff notification পায় expiration আগে

### Use Case 4: Access Revocation

1. Manager staff-এর access revoke করে
2. Staff immediately access হারায়
3. Staff notification পায়
4. Staff নতুন করে request করতে পারে

## Error Handling

### Common Errors

1. **"User is not a member of this branch"**
   - Solution: Staff-কে আগে branch-এ invite করতে হবে

2. **"Only branch managers or org owners can approve access"**
   - Solution: শুধুমাত্র manager/owner approve করতে পারবে

3. **"Expiration date must be in the future"**
   - Solution: Expiration date future date হতে হবে

4. **"Permission request not found"**
   - Solution: Valid permission ID use করুন

## Best Practices

1. **Always Check Access**: Branch access করার আগে always `check/:branchId` call করুন
2. **Handle Pending Status**: PENDING status-এর জন্য proper UI show করুন
3. **Expiration Warnings**: Expiration date-এর জন্য warning show করুন
4. **Error Handling**: Proper error handling implement করুন
5. **Notifications**: In-app notifications check করুন email-এর পাশাপাশি

## Testing

### Test Scenarios

1. **Staff Login**: Check login response-এ access status আছে
2. **Request Access**: Staff request করতে পারে
3. **Manager Approval**: Manager approve করতে পারে
4. **Access Check**: Approved access check হয়
5. **Expiration**: Expired permissions properly handle হয়
6. **Revocation**: Revoked access properly handle হয়

### Test Commands

```bash
# Test API endpoints
curl -X POST http://localhost:3000/api/v1/branch-access/request \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"branchId": 1}'

curl http://localhost:3000/api/v1/branch-access/my-requests \
  -H "Authorization: Bearer TOKEN"
```

## Troubleshooting

### Issue: Permission not found after migration

**Solution**: Prisma Client regenerate করুন:
```bash
npx prisma generate
```

### Issue: Existing members don't have access

**Solution**: Backfill script run করুন:
```bash
npm run backfill:branch-access
```

### Issue: Email notifications not sending

**Solution**: SMTP configuration check করুন `.env` file-এ:
```
SMTP_HOST=...
SMTP_PORT=...
SMTP_USER=...
SMTP_PASS=...
```

## API Response Codes

- **200**: Success
- **400**: Bad Request (invalid data)
- **401**: Unauthorized (no token)
- **403**: Forbidden (no permission)
- **404**: Not Found (resource doesn't exist)
- **500**: Server Error

## Summary

এই system-এর মাধ্যমে:

✅ Staff একাধিক branch-এ কাজ করতে পারবে
✅ Manager control করতে পারবে কে কোন branch access পাবে
✅ Time-based expiration support আছে
✅ Automatic email notifications
✅ Grandfathered access existing members-এর জন্য
✅ Complete audit trail (who approved, when, etc.)

সব documentation এবং examples `docs/` folder-এ আছে।
