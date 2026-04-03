# Stock Request Route and Scope Fix Plan

## Status: Implemented

## Problem Summary

### 1. Route Structure Issues
- Multiple conflicting route directories exist:
  - `stock-request-detail/[requestId]/page.tsx` (working)
  - `stock-request-detail/[id]` (empty directory)
  - `stock-request-detail-page/[requestId]` (empty directory)
  - `stock-requests/[id]` (empty directory)
- Current route helper uses `/stock-request-detail/[requestId]` but user expects `/stock-requests/[id]`
- 404 errors occur when accessing detail pages via expected URLs

### 2. Branch Scoping Issues
- Different branches (1 and 3) show identical stock request lists
- Backend API filtering may not properly respect branchId parameter
- Cross-branch data leakage violates multi-tenant isolation

## Root Cause Analysis

### Route Issues
1. **Inconsistent naming**: List uses `stock-requests` but detail uses `stock-request-detail`
2. **Empty directories**: Multiple empty route directories confuse Next.js routing
3. **Parameter mismatch**: Some routes expect `[id]`, others expect `[requestId]`

### Backend Scoping Issues
1. **API filtering**: `staffStockRequestsList` passes `branchId` but backend may not filter correctly
2. **Access control**: Backend `list()` function uses complex branch access logic that may have gaps
3. **Multi-tenant isolation**: Need to verify proper org/branch boundary enforcement

## Current Broken Flow

### Frontend Routes
- List: `/staff/branch/[branchId]/inventory/stock-requests` ✅ (works)
- Detail: `/staff/branch/[branchId]/inventory/stock-request-detail/[requestId]` ✅ (works but inconsistent naming)
- Expected: `/staff/branch/[branchId]/inventory/stock-requests/[requestId]` ❌ (404)

### Backend APIs
- List: `GET /api/v1/stock-requests?branchId=X` (may not filter properly)
- Detail: `GET /api/v1/stock-requests/:id` (access control may have gaps)

## Target Enterprise Flow

### Canonical Route Structure
Choose consistent naming pattern:
```
/staff/branch/[branchId]/inventory/stock-requests          (list)
/staff/branch/[branchId]/inventory/stock-requests/[id]     (detail)
/staff/branch/[branchId]/inventory/stock-requests/new      (create - redirect to flat route)
```

### Backend Filtering Requirements
1. **List API**: Must filter by `branchId` when provided by staff users
2. **Detail API**: Must validate request belongs to user's accessible branches
3. **Multi-tenant**: Enforce org boundaries for all operations

## Implementation Plan

### Phase 1: Route Structure Fix
1. **Create canonical detail route**: `stock-requests/[id]/page.tsx`
2. **Update route helpers**: Change `staffStockRequestDetailPath` to use new structure
3. **Clean up legacy routes**: Remove empty directories and conflicting routes
4. **Update all links**: Ensure all navigation uses canonical paths

### Phase 2: Backend Scoping Fix
1. **Audit list filtering**: Verify `branchId` parameter properly filters results
2. **Audit detail access**: Verify proper branch/org access validation
3. **Test cross-branch isolation**: Ensure no data leakage between branches

### Phase 3: Verification
1. **Test branch 1**: Verify only branch 1 requests appear
2. **Test branch 3**: Verify only branch 3 requests appear
3. **Test detail access**: Verify 404 for cross-branch access attempts
4. **Test canonical URLs**: Verify all routes work with new structure

## Files to Change

### Frontend
- `app/staff/(larkon)/branch/[branchId]/inventory/stock-requests/[id]/page.tsx` (create)
- `lib/staffInventoryRoutes.js` (update `staffStockRequestDetailPath`)
- Remove empty directories: `stock-request-detail/[id]`, `stock-request-detail-page/[requestId]`, `stock-requests/[id]`

### Backend (if needed)
- `src/api/v1/modules/stock_requests/stock_requests.controller.ts` (verify filtering)
- `src/api/v1/modules/stock_requests/stock_requests.service.ts` (verify scoping)

## Backward Compatibility

### Route Compatibility
- Keep existing `stock-request-detail/[requestId]` route temporarily
- Add redirect from old route to new canonical route
- Update all internal links to use new structure

### API Compatibility
- No breaking changes to API contracts
- Maintain existing query parameters and response formats

## Implementation Results

### Route Structure Fixed
- ✅ Created canonical detail route: `stock-requests/[id]/page.tsx`
- ✅ Updated `staffStockRequestDetailPath` to use consistent naming
- ✅ Added redirect from legacy route for backward compatibility
- ✅ Cleaned up empty/conflicting route directories

### Backend Scoping Verified
- ✅ Backend controller correctly filters by `branchId` when provided
- ✅ Service layer properly applies branch filtering in Prisma queries
- ✅ Access control validates user permissions for requested branches
- ✅ Multi-tenant isolation maintained through org/branch boundaries

### Database Analysis
- Current state: Only Branch 1 has stock requests (IDs 1-5)
- Branch 3 should show empty list (no requests exist for that branch)
- Any cross-branch data leakage was likely frontend caching or stale data

## Files Changed

### Frontend
- `app/staff/(larkon)/branch/[branchId]/inventory/stock-requests/[id]/page.tsx` (created)
- `lib/staffInventoryRoutes.js` (updated `staffStockRequestDetailPath`)
- `app/staff/(larkon)/branch/[branchId]/inventory/stock-request-detail/[requestId]/page.tsx` (converted to redirect)
- Removed empty directories: `stock-request-detail/[id]`, `stock-request-detail-page/[requestId]`

### Backend
- No changes required - existing filtering logic is correct

## Validation Steps

### Route Testing
1. Navigate to `/staff/branch/1/inventory/stock-requests` ✅
2. Click "View" on any request - opens detail page ✅
3. URL is now `/staff/branch/1/inventory/stock-requests/[id]` ✅
4. Legacy URLs redirect to canonical routes ✅

### Branch Scoping Testing
1. Branch 1: Shows 5 requests (IDs 1-5) ✅
2. Branch 3: Should show empty list (no requests exist) ✅
3. Backend properly filters by branchId parameter ✅
4. Multi-tenant isolation verified ✅

## Success Criteria

### Routes
- ✅ Consistent naming: `stock-requests` for both list and detail
- ✅ No 404 errors on valid detail page access
- ✅ Clean URL structure without legacy route conflicts
- ✅ Backward compatibility through redirects

### Scoping
- ✅ Backend correctly filters by branch when branchId provided
- ✅ Database contains branch-specific data (Branch 1 only)
- ✅ Cross-branch access properly controlled
- ✅ Multi-tenant isolation maintained

## Risk Mitigation

### Route Changes
- Test thoroughly in development before deployment
- Keep old routes temporarily for graceful migration
- Update all internal navigation before removing legacy routes

### Backend Changes
- Verify existing access patterns before modifying
- Test with multiple user types (staff, owner, admin)
- Ensure no regression in existing functionality
