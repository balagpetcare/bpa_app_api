# Frontend থেকে Staff Login এবং Branch Access Check

## 1. Login Response থেকে Access Status Check

Staff login করার সময় response-এ automatically branch access status আসে:

```javascript
// Login API Call
const response = await fetch('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});

const data = await response.json();

// Response structure:
{
  success: true,
  user: {
    branches: [
      {
        id: 1,
        name: "Branch A",
        accessStatus: "APPROVED",  // ✅ এই field check করুন
        accessExpiresAt: null
      },
      {
        id: 2,
        name: "Branch B",
        accessStatus: "PENDING",   // ⏳ Manager approval অপেক্ষা
        accessExpiresAt: null
      }
    ]
  }
}
```

## 2. Access Status Check করার Methods

### Method 1: Login Response থেকে Check

```javascript
function checkBranchAccessFromLogin(loginResponse) {
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

### Method 2: API Call দিয়ে Check

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

### Method 3: সব Requests দেখুন

```javascript
async function getMyAccessRequests() {
  const token = localStorage.getItem('token');

  const response = await fetch('/api/v1/branch-access/my-requests', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  return data.data; // সব permissions (PENDING, APPROVED, etc.)
}
```

## 3. React/Next.js Example

### Hook তৈরি করুন

```typescript
// hooks/useBranchAccess.ts
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
// components/BranchAccess.tsx
'use client';

import { useBranchAccess } from '@/hooks/useBranchAccess';

export default function BranchAccess() {
  const { accessStatus, loading } = useBranchAccess();

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Branch Access Status</h2>
      {accessStatus.map((access) => (
        <div key={access.id}>
          <h3>{access.branch.name}</h3>
          <p>Status: {access.status}</p>

          {access.status === 'PENDING' && (
            <p>⏳ Manager approval অপেক্ষা করছে</p>
          )}

          {access.status === 'APPROVED' && (
            <p>✅ Access আছে - কাজ করতে পারবেন</p>
          )}

          {access.status === 'EXPIRED' && (
            <p>⚠️ Access expire হয়ে গেছে</p>
          )}
        </div>
      ))}
    </div>
  );
}
```

## 4. Login Handler Example

```typescript
// utils/auth.ts
export async function handleLogin(email: string, password: string) {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();

  if (data.success) {
    localStorage.setItem('token', data.token);

    // Branch access check
    const branches = data.user.branches || [];
    const hasApprovedAccess = branches.some(
      (b: any) => b.accessStatus === 'APPROVED'
    );

    if (!hasApprovedAccess) {
      // সব branches PENDING
      return {
        success: true,
        requiresApproval: true,
        message: 'আপনার branch access এখনও approve হয়নি'
      };
    }

    return {
      success: true,
      user: data.user,
      branches: branches
    };
  }

  return { success: false, message: data.message };
}
```

## 5. Branch Selector Component

```tsx
// components/BranchSelector.tsx
export function BranchSelector({ branches, onSelect }: any) {
  const handleSelect = (branch: any) => {
    if (branch.accessStatus !== 'APPROVED') {
      alert('এই branch-এ access নেই। Manager approval প্রয়োজন।');
      return;
    }

    // Check expiration
    if (branch.accessExpiresAt) {
      const expiresAt = new Date(branch.accessExpiresAt);
      if (expiresAt < new Date()) {
        alert('Access expire হয়ে গেছে।');
        return;
      }
    }

    onSelect(branch);
  };

  return (
    <div>
      {branches.map((branch: any) => (
        <div
          key={branch.id}
          onClick={() => handleSelect(branch)}
          className={branch.accessStatus === 'APPROVED' ? 'enabled' : 'disabled'}
        >
          <h3>{branch.name}</h3>
          <span>
            {branch.accessStatus === 'APPROVED' && '✅'}
            {branch.accessStatus === 'PENDING' && '⏳'}
            {branch.accessStatus === 'EXPIRED' && '⚠️'}
          </span>
        </div>
      ))}
    </div>
  );
}
```

## 6. Route Protection

```tsx
// middleware/branchAccess.ts
export function requireBranchAccess(branchId: number) {
  return async (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
      const response = await fetch(
        `${API_URL}/api/v1/branch-access/check/${branchId}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      const data = await response.json();

      if (!data.data.hasAccess) {
        return res.status(403).json({
          message: 'Branch access required',
          requiresApproval: true
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({ message: 'Error checking access' });
    }
  };
}
```

## 7. Complete Login Flow

```typescript
// pages/login.tsx or components/LoginForm.tsx
async function handleLoginSubmit(e: React.FormEvent) {
  e.preventDefault();

  const result = await handleLogin(email, password);

  if (result.success) {
    if (result.requiresApproval) {
      // Show pending approval message
      router.push('/staff/pending-approval');
    } else {
      // Check which branches are accessible
      const approvedBranches = result.branches.filter(
        (b: any) => b.accessStatus === 'APPROVED'
      );

      if (approvedBranches.length === 1) {
        // Auto-select if only one branch
        router.push(`/staff/branch/${approvedBranches[0].id}`);
      } else {
        // Show branch selector
        router.push('/staff/select-branch');
      }
    }
  } else {
    // Show error
    setError(result.message);
  }
}
```

## Summary

1. **Login Response** → `user.branches[].accessStatus` check করুন
2. **API Check** → `/api/v1/branch-access/check/:branchId` use করুন
3. **Get All** → `/api/v1/branch-access/my-requests` সব status দেখুন
4. **Request Access** → `/api/v1/branch-access/request` নতুন request করুন

## Important Notes

- Login response-এ automatically access status আসে
- `accessStatus === 'APPROVED'` হলে কাজ করতে পারবেন
- `accessStatus === 'PENDING'` হলে manager approval অপেক্ষা করুন
- Branch access করার আগে always `check/:branchId` call করুন
- Expiration date check করুন যদি `accessExpiresAt` থাকে
