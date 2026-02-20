# Frontend Branch Access API Guide

এই guide-এ frontend থেকে staff login এবং branch access check করার সব methods আছে।

## 1. Login Response - Branch Access Status

Staff login করার সময় response-এ branch access status automatically include হয়:

### Login Endpoint
```
POST /api/v1/auth/login
```

### Response Structure
```json
{
  "success": true,
  "token": "jwt_token_here",
  "user": {
    "id": 123,
    "email": "staff@example.com",
    "role": "STAFF",
    "branches": [
      {
        "id": 1,
        "name": "Branch A",
        "type": "CLINIC",
        "role": "BRANCH_STAFF",
        "accessStatus": "APPROVED",  // ✅ নতুন field
        "accessExpiresAt": null      // ✅ নতুন field
      },
      {
        "id": 2,
        "name": "Branch B",
        "type": "SHOP",
        "role": "BRANCH_STAFF",
        "accessStatus": "PENDING",   // ⏳ Manager approval প্রয়োজন
        "accessExpiresAt": null
      },
      {
        "id": 3,
        "name": "Branch C",
        "type": "CLINIC",
        "role": "BRANCH_STAFF",
        "accessStatus": "APPROVED",
        "accessExpiresAt": "2026-12-31T23:59:59Z"  // ⚠️ Expiration date
      }
    ]
  }
}
```

### Access Status Values
- `PENDING` - Manager approval অপেক্ষা করছে
- `APPROVED` - Access আছে, কাজ করতে পারবে
- `REVOKED` - Access revoked হয়েছে
- `EXPIRED` - Access expire হয়ে গেছে

## 2. Check Branch Access Status

### Endpoint
```
GET /api/v1/branch-access/check/:branchId
```

### Request
```javascript
// Example: Check access to branch 1
const response = await fetch('/api/v1/branch-access/check/1', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
// Response: { success: true, data: { hasAccess: true, branchId: 1 } }
```

### Response
```json
{
  "success": true,
  "data": {
    "hasAccess": true,
    "branchId": 1
  }
}
```

## 3. Get Staff's All Permission Requests

### Endpoint
```
GET /api/v1/branch-access/my-requests
```

### Request
```javascript
const response = await fetch('/api/v1/branch-access/my-requests', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
```

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "branchId": 1,
      "userId": 123,
      "status": "APPROVED",
      "requestedAt": "2026-01-28T10:00:00Z",
      "approvedAt": "2026-01-28T11:00:00Z",
      "expiresAt": null,
      "branch": {
        "id": 1,
        "name": "Branch A",
        "org": {
          "id": 1,
          "name": "Organization Name"
        }
      }
    },
    {
      "id": 2,
      "branchId": 2,
      "status": "PENDING",
      "requestedAt": "2026-01-28T12:00:00Z",
      "branch": {
        "id": 2,
        "name": "Branch B"
      }
    }
  ]
}
```

## 4. Request Branch Access

### Endpoint
```
POST /api/v1/branch-access/request
```

### Request
```javascript
const response = await fetch('/api/v1/branch-access/request', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    branchId: 1
  })
});

const data = await response.json();
```

### Response
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

## 5. Get Active Permissions Only

### Endpoint
```
GET /api/v1/branch-access/active
```

### Response
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "branchId": 1,
      "status": "APPROVED",
      "expiresAt": null,
      "branch": {
        "id": 1,
        "name": "Branch A"
      }
    }
  ]
}
```

## Frontend Implementation Examples

### React/Next.js Example

```typescript
// hooks/useBranchAccess.ts
import { useState, useEffect } from 'react';

interface BranchAccess {
  branchId: number;
  branchName: string;
  accessStatus: 'PENDING' | 'APPROVED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string | null;
}

export function useBranchAccess() {
  const [accessStatus, setAccessStatus] = useState<BranchAccess[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAccessStatus();
  }, []);

  const fetchAccessStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/branch-access/my-requests', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        setAccessStatus(data.data);
      }
    } catch (error) {
      console.error('Error fetching access status:', error);
    } finally {
      setLoading(false);
    }
  };

  const requestAccess = async (branchId: number) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/branch-access/request', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ branchId })
      });
      const data = await response.json();
      if (data.success) {
        await fetchAccessStatus(); // Refresh
        return { success: true, message: data.message };
      }
      return { success: false, message: data.message };
    } catch (error) {
      return { success: false, message: 'Failed to request access' };
    }
  };

  const checkAccess = async (branchId: number): Promise<boolean> => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/branch-access/check/${branchId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      return data.success && data.data.hasAccess;
    } catch (error) {
      return false;
    }
  };

  return {
    accessStatus,
    loading,
    requestAccess,
    checkAccess,
    refresh: fetchAccessStatus
  };
}
```

### Login Handler Example

```typescript
// utils/auth.ts
export async function handleStaffLogin(email: string, password: string) {
  try {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (data.success) {
      // Save token
      localStorage.setItem('token', data.token);

      // Check branch access status
      const branches = data.user.branches || [];

      // Filter branches by access status
      const approvedBranches = branches.filter(
        (b: any) => b.accessStatus === 'APPROVED'
      );
      const pendingBranches = branches.filter(
        (b: any) => b.accessStatus === 'PENDING'
      );
      const expiredBranches = branches.filter(
        (b: any) => b.accessStatus === 'EXPIRED'
      );

      return {
        success: true,
        user: data.user,
        branches: {
          all: branches,
          approved: approvedBranches,
          pending: pendingBranches,
          expired: expiredBranches
        }
      };
    }

    return { success: false, message: data.message };
  } catch (error) {
    return { success: false, message: 'Login failed' };
  }
}
```

### UI Component Example

```tsx
// components/BranchAccessStatus.tsx
import React from 'react';
import { useBranchAccess } from '@/hooks/useBranchAccess';

export function BranchAccessStatus() {
  const { accessStatus, loading, requestAccess } = useBranchAccess();

  if (loading) return <div>Loading...</div>;

  return (
    <div className="branch-access-status">
      <h2>Branch Access Status</h2>

      {accessStatus.map((access) => (
        <div key={access.branchId} className="access-item">
          <h3>{access.branchName}</h3>

          {access.accessStatus === 'APPROVED' && (
            <div className="status approved">
              ✅ Access Approved
              {access.expiresAt && (
                <p>Expires: {new Date(access.expiresAt).toLocaleDateString()}</p>
              )}
            </div>
          )}

          {access.accessStatus === 'PENDING' && (
            <div className="status pending">
              ⏳ Waiting for Manager Approval
              <button onClick={() => requestAccess(access.branchId)}>
                Resend Request
              </button>
            </div>
          )}

          {access.accessStatus === 'REVOKED' && (
            <div className="status revoked">
              ❌ Access Revoked
              <button onClick={() => requestAccess(access.branchId)}>
                Request Again
              </button>
            </div>
          )}

          {access.accessStatus === 'EXPIRED' && (
            <div className="status expired">
              ⚠️ Access Expired
              <button onClick={() => requestAccess(access.branchId)}>
                Request Renewal
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### Branch Selection with Access Check

```tsx
// components/BranchSelector.tsx
import React, { useState, useEffect } from 'react';

export function BranchSelector({ onBranchSelect }: { onBranchSelect: (branchId: number) => void }) {
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);

  useEffect(() => {
    // Get branches from login response or API
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    setBranches(userData.branches || []);
  }, []);

  const handleBranchSelect = async (branchId: number) => {
    // Check access before allowing selection
    const branch = branches.find((b) => b.id === branchId);

    if (!branch) return;

    if (branch.accessStatus === 'PENDING') {
      alert('আপনার এই branch-এ access এখনও approve হয়নি। Manager-এর approval অপেক্ষা করুন।');
      return;
    }

    if (branch.accessStatus === 'REVOKED') {
      alert('আপনার এই branch-এ access revoked হয়েছে।');
      return;
    }

    if (branch.accessStatus === 'EXPIRED') {
      alert('আপনার access expire হয়ে গেছে। নতুন করে request করুন।');
      return;
    }

    if (branch.accessStatus === 'APPROVED') {
      // Check expiration date
      if (branch.accessExpiresAt) {
        const expiresAt = new Date(branch.accessExpiresAt);
        if (expiresAt < new Date()) {
          alert('আপনার access expire হয়ে গেছে।');
          return;
        }
      }

      setSelectedBranch(branchId);
      onBranchSelect(branchId);
    }
  };

  return (
    <div className="branch-selector">
      <h2>Select Branch</h2>
      {branches.map((branch) => (
        <div
          key={branch.id}
          className={`branch-card ${branch.accessStatus === 'APPROVED' ? 'active' : 'disabled'}`}
          onClick={() => handleBranchSelect(branch.id)}
        >
          <h3>{branch.name}</h3>
          <p>Type: {branch.type}</p>
          <p>Role: {branch.role}</p>
          <div className={`status ${branch.accessStatus.toLowerCase()}`}>
            {branch.accessStatus === 'APPROVED' && '✅ Approved'}
            {branch.accessStatus === 'PENDING' && '⏳ Pending Approval'}
            {branch.accessStatus === 'REVOKED' && '❌ Revoked'}
            {branch.accessStatus === 'EXPIRED' && '⚠️ Expired'}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Route Protection Example

```tsx
// components/ProtectedBranchRoute.tsx
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export function ProtectedBranchRoute({
  branchId,
  children
}: {
  branchId: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);

  useEffect(() => {
    checkAccess();
  }, [branchId]);

  const checkAccess = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/v1/branch-access/check/${branchId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();

      if (data.success && data.data.hasAccess) {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        // Redirect to access request page
        router.push(`/staff/branch-access/request?branchId=${branchId}`);
      }
    } catch (error) {
      setHasAccess(false);
    }
  };

  if (hasAccess === null) {
    return <div>Checking access...</div>;
  }

  if (!hasAccess) {
    return (
      <div>
        <h2>Access Required</h2>
        <p>আপনার এই branch-এ access নেই। Manager-এর approval প্রয়োজন।</p>
      </div>
    );
  }

  return <>{children}</>;
}
```

## Manager Dashboard Endpoints

### Get Pending Requests
```
GET /api/v1/branch-access/pending
```

### Approve Request
```
POST /api/v1/branch-access/:id/approve
Body: { expiresAt?: "2026-12-31T23:59:59Z" }
```

### Revoke Access
```
POST /api/v1/branch-access/:id/revoke
```

### Get All Permissions for Branch
```
GET /api/v1/branch-access/branch/:branchId
```

## Complete Flow

1. **Staff Login** → Check `branches[].accessStatus` in response
2. **If PENDING** → Show "Waiting for approval" message
3. **If APPROVED** → Allow access to branch
4. **If EXPIRED/REVOKED** → Show message and allow re-request
5. **Before accessing branch** → Call `check/:branchId` to verify
6. **Manager Dashboard** → Show pending requests and approve/reject

## Error Handling

```typescript
try {
  const response = await fetch('/api/v1/branch-access/check/1', {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Unauthorized - redirect to login
      router.push('/login');
    } else if (response.status === 403) {
      // Forbidden - no access
      showAccessDeniedMessage();
    }
  }

  const data = await response.json();
  // Handle response
} catch (error) {
  console.error('Error:', error);
  showErrorMessage('Failed to check access');
}
```
