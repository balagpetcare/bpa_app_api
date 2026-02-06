# Frontend Examples

এই folder-এ frontend integration-এর জন্য example code আছে।

## Files

- `branchAccessClient.ts` - API client helper functions

## Usage

### Install in your frontend project

```bash
# Copy the file to your frontend project
cp branchAccessClient.ts src/lib/branchAccessClient.ts
```

### Use in your components

```typescript
import { branchAccessClient } from '@/lib/branchAccessClient';

// Check access
const hasAccess = await branchAccessClient.checkAccess(branchId);

// Get all requests
const requests = await branchAccessClient.getMyRequests();

// Request access
const result = await branchAccessClient.requestAccess(branchId);

// Parse login response
const accessInfo = branchAccessClient.parseLoginResponse(loginResponse);
```

## See Also

- `../FRONTEND_BRANCH_ACCESS_API.md` - Complete API documentation
- `../FRONTEND_BRANCH_ACCESS_BN.md` - Bengali guide
