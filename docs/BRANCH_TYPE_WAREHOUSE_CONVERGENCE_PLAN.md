# Branch Type Warehouse Convergence Plan

**Date:** April 3, 2026
**Status:** Planning Phase
**Objective:** Converge separate Warehouse entity/module with Branch domain using Branch Types

---

## Executive Summary

The current system has duplicate warehouse creation/management flows:
1. **Separate Warehouse Domain**: `Warehouse` model with dedicated controllers/services/routes
2. **Branch-based Warehouse**: `Branch` model with `WAREHOUSE_DC` type support

This creates confusion, data duplication, and maintenance overhead. The goal is to converge to a single source of truth where **Warehouse = Branch with branchType = WAREHOUSE_DC**.

---

## Current State Audit

### Existing Warehouse Architecture

#### Backend (Separate Warehouse Domain)
- **Model**: `Warehouse` (lines 12711-12752 in schema.prisma)
  - Fields: `id`, `orgId`, `branchId?`, `name`, `code`, `type`, `addressJson`, `location`, `managerId`, `isActive`
  - Relations: `org`, `branch?`, `manager`, `staff`, `locations`, `zones`
  - **Key Issue**: Optional `branchId` link suggests intended convergence but not enforced

- **Routes**: `/api/v1/warehouse` (registered TWICE in routes.ts - lines 231, 389)
  - CRUD operations: create, list, getById, update
  - Staff management: invite, add, remove staff
  - Location linking: link/unlink locations
  - Operations: dashboard, reports, zones, dispatches

- **Controllers/Services**:
  - `warehouse.controller.ts` - Full CRUD + staff + operations
  - `warehouse.service.ts` - Business logic
  - `warehouseOperations.controller.ts` - Operations dashboard
  - `warehouseReports.controller.ts` - Reporting
  - `warehouseAudit.controller.ts` - Audit trails

#### Backend (Branch-based Warehouse Support)
- **Model**: `Branch` (lines 3030-3212 in schema.prisma)
  - Types: `BranchToType[]` relation with `BranchType.code = 'WAREHOUSE_DC'`
  - Capabilities: `capabilitiesJson` can include warehouse semantics
  - **Key Issue**: Underutilized for warehouse use cases

- **Routes**: `/api/v1/owner/organizations/:orgId/branches` (line 99 in owner.routes.ts)
  - Branch creation supports warehouse types
  - Branch management through owner panel

- **Controllers**:
  - `owner.controller.ts` - `createBranch` supports warehouse types
  - `branches.controller.ts` - Branch member management with warehouse roles

#### Frontend (Missing Warehouse UI)
- **No dedicated warehouse pages found** in `bpa_web/app/owner/`
- **Owner Panel**: Branch creation flow exists but warehouse-specific UI missing
- **Navigation**: No warehouse menu entries detected

#### Data Duplication Issues
1. **Staff Management**: Both `WarehouseStaffAssignment` and `BranchMember` exist
2. **Location Linking**: Warehouses link to `InventoryLocation` but branches also have `inventoryLocations`
3. **Permissions**: Warehouse-specific roles vs branch-based RBAC
4. **Creation Flow**: Two separate creation endpoints with different validation

---

## Target Architecture

### Canonical Entity Rules
1. **Branch is the single source of truth** for all physical locations
2. **Warehouse = Branch** with:
   - `types` includes `BranchType.code = 'WAREHOUSE_DC'`
   - `capabilitiesJson` includes warehouse-specific capabilities
   - `featuresJson` enables warehouse modules
3. **No separate Warehouse model creation** - only through Branch flow
4. **Warehouse UI** becomes filtered Branch management views

### Branch Type Configuration
```json
// BranchType for warehouses
{
  "code": "WAREHOUSE_DC",
  "nameEn": "Distribution Center",
  "nameBn": "বিতরণ কেন্দ্র"
}

// Branch.capabilitiesJson for warehouse
{
  "warehouse": true,
  "inventory_management": true,
  "dispatch": true,
  "receiving": true,
  "quality_control": true
}

// Branch.featuresJson for warehouse modules
{
  "warehouseEnabled": true,
  "inventoryEnabled": true,
  "dispatchEnabled": true,
  "reportsEnabled": true
}
```

---

## Migration Strategy

### Phase 1: Backend Convergence (Non-Breaking)
1. **Warehouse Creation Convergence**
   - Modify `warehouse.controller.create` to create Branch record with warehouse type
   - Maintain `Warehouse` model as read-only compatibility layer
   - Ensure all new warehouses are Branch-backed

2. **Staff Management Convergence**
   - Route warehouse staff operations through `BranchMember` system
   - Map `WarehouseStaffRole` to `MemberRole` equivalents
   - Maintain `WarehouseStaffAssignment` for existing records

3. **Location Linking Convergence**
   - Ensure `InventoryLocation.branchId` is populated for warehouse locations
   - Use Branch as primary location parent, not Warehouse

### Phase 2: Frontend Implementation
1. **Owner Warehouse Menu**
   - Create warehouse list as filtered branch view
   - "New Warehouse" redirects to branch creation with warehouse type preset
   - Warehouse detail pages load branch-backed data

2. **Branch Creation Enhancement**
   - Add warehouse type selection in branch creation wizard
   - Pre-configure warehouse capabilities when warehouse type selected
   - Validate warehouse-specific requirements

### Phase 3: Deprecation (Breaking Changes)
1. **Remove Duplicate Routes**
   - Deprecate direct warehouse creation endpoints
   - Redirect warehouse operations to branch-based equivalents
   - Remove duplicate route registrations

2. **Schema Cleanup**
   - Mark `Warehouse` model as deprecated
   - Add migration to link existing warehouses to branches
   - Eventually remove `Warehouse` model (future release)

---

## Affected Files Analysis

### Backend Files to Modify

#### High Priority (Core Logic)
- `src/api/v1/modules/warehouse/warehouse.controller.ts` - **REFACTOR**: Route create to branch creation
- `src/api/v1/modules/warehouse/warehouse.service.ts` - **REFACTOR**: Use branch queries
- `src/api/v1/modules/owner/owner.controller.ts` - **ENHANCE**: Branch creation for warehouses
- `src/api/v1/routes.ts` - **FIX**: Remove duplicate warehouse route registration

#### Medium Priority (Operations)
- `src/api/v1/modules/warehouse/warehouseOperations.controller.ts` - **ADAPT**: Query branch-backed warehouses
- `src/api/v1/modules/warehouse/warehouseReports.controller.ts` - **ADAPT**: Report on branch data
- `src/api/v1/modules/branches/branches.controller.ts` - **ENHANCE**: Warehouse-specific branch operations

#### Low Priority (Compatibility)
- `src/api/v1/modules/warehouse/warehouseAudit.controller.ts` - **MAINTAIN**: Audit both sources during transition
- `src/api/v1/utils/warehouseStaffRoleMapping.ts` - **ENHANCE**: Map to branch roles
- `src/scripts/linkWarehousesToBranches.ts` - **EXECUTE**: Data migration script

### Frontend Files to Create/Modify

#### Owner Panel Warehouse Section
- `app/owner/(larkon)/warehouse/page.tsx` - **CREATE**: Warehouse list (filtered branches)
- `app/owner/(larkon)/warehouse/new/page.tsx` - **CREATE**: Redirect to branch creation
- `app/owner/(larkon)/warehouse/[id]/page.tsx` - **CREATE**: Warehouse detail (branch-backed)
- `app/owner/(larkon)/warehouse/[id]/staff/page.tsx` - **CREATE**: Staff management (branch members)

#### Branch Creation Enhancement
- `app/owner/(larkon)/branches/new/page.tsx` - **ENHANCE**: Add warehouse type support
- `app/owner/(larkon)/branches/[id]/edit/page.tsx` - **ENHANCE**: Warehouse-specific settings

#### Navigation & Routing
- `src/lib/permissionMenu.ts` - **ADD**: Warehouse menu entries
- `src/larkon-admin/menu/adapters/adminRouteMap.ts` - **ADD**: Admin warehouse routes

---

## Duplication Points Identified

### 1. Creation Endpoints
- **Duplicate**: `POST /api/v1/warehouse` vs `POST /api/v1/owner/organizations/:orgId/branches`
- **Resolution**: Warehouse creation redirects to branch creation with warehouse type preset

### 2. Staff Management
- **Duplicate**: `WarehouseStaffAssignment` vs `BranchMember`
- **Resolution**: Use `BranchMember` as canonical, maintain compatibility layer

### 3. Location Relationships
- **Duplicate**: `Warehouse.locations` vs `Branch.inventoryLocations`
- **Resolution**: Use `Branch.inventoryLocations` as canonical

### 4. Dashboard/Operations
- **Duplicate**: Warehouse dashboard vs Branch dashboard
- **Resolution**: Warehouse dashboard becomes specialized branch dashboard view

### 5. Route Registration
- **Duplicate**: Two `/warehouse` route registrations in routes.ts
- **Resolution**: Remove one registration, consolidate routes

---

## Backward Compatibility Strategy

### API Compatibility
1. **Maintain Existing Endpoints** (Phase 1)
   - Keep `/api/v1/warehouse/*` endpoints functional
   - Route requests to branch-backed data internally
   - Return same response format

2. **Deprecation Headers** (Phase 2)
   - Add `X-Deprecated: true` header to warehouse endpoints
   - Include `X-Migration-Guide` header with new endpoint info

3. **Sunset Timeline** (Phase 3)
   - 3 months deprecation notice
   - 6 months sunset period
   - Remove deprecated endpoints

### Data Migration
1. **Existing Warehouse Records**
   - Run `linkWarehousesToBranches.ts` script to create Branch records
   - Link existing `InventoryLocation` records to new Branch
   - Migrate `WarehouseStaffAssignment` to `BranchMember`

2. **ID Mapping**
   - Maintain `Warehouse.branchId` foreign key during transition
   - Create mapping table if needed for external integrations

---

## UI Redirect Strategy

### Owner Panel Flow
1. **Warehouse List Page** (`/owner/warehouse`)
   - Show filtered list of branches with warehouse types
   - "New Warehouse" button → `/owner/branches/new?type=warehouse`
   - Warehouse cards → `/owner/warehouse/[branchId]` (compatibility route)

2. **Warehouse Creation** (`/owner/warehouse/new`)
   - Redirect to `/owner/branches/new?type=warehouse&preset=distribution_center`
   - Pre-fill warehouse-specific form fields
   - Set warehouse capabilities by default

3. **Warehouse Detail** (`/owner/warehouse/[id]`)
   - Resolve `id` to `branchId` via compatibility mapping
   - Load branch-backed warehouse data
   - Show warehouse-specific dashboard sections

### Navigation Updates
1. **Sidebar Menu**
   - Keep "Warehouse" menu item for UX continuity
   - Route to filtered branch management
   - Add warehouse-specific sub-menu items

2. **Breadcrumbs**
   - Maintain warehouse terminology in UI
   - Internal routing uses branch IDs
   - Preserve user-facing warehouse concept

---

## Route Deprecation Strategy

### Immediate (Phase 1)
- **Fix**: Remove duplicate route registration in `routes.ts`
- **Maintain**: All existing warehouse endpoints functional
- **Add**: Deprecation logging for monitoring usage

### Short-term (Phase 2 - 3 months)
- **Deprecate**: `POST /api/v1/warehouse` (creation)
- **Redirect**: Creation requests to branch creation flow
- **Maintain**: Read operations for compatibility

### Long-term (Phase 3 - 6 months)
- **Remove**: All dedicated warehouse CRUD endpoints
- **Consolidate**: Operations under branch-based warehouse routes
- **Document**: Migration guide for external integrations

---

## RBAC Alignment

### Role Mapping
| Warehouse Role | Branch Role | Permissions |
|---------------|-------------|-------------|
| `WAREHOUSE_MANAGER` | `BRANCH_MANAGER` | Full warehouse operations |
| `RECEIVING_STAFF` | `BRANCH_STAFF` | Inbound operations |
| `DISPATCH_STAFF` | `BRANCH_STAFF` | Outbound operations |
| `INVENTORY_CONTROLLER` | `BRANCH_STAFF` | Stock management |
| `QC_OFFICER` | `BRANCH_STAFF` | Quality control |

### Permission Alignment
- Warehouse permissions map to branch-scoped permissions
- Use `capabilitiesJson` to enable warehouse-specific features
- Maintain granular permissions within warehouse operations

### Staff Invitation Flow
- Use existing branch staff invitation system
- Filter available roles based on warehouse branch type
- Maintain warehouse-specific role descriptions

---

## Data/Model Cleanup Notes

### Schema Changes Required
1. **Enforce Branch Link** in Warehouse model
   ```sql
   -- Make branchId required for new warehouses
   ALTER TABLE warehouses ADD CONSTRAINT warehouse_branch_required
   CHECK (created_at < '2026-04-03' OR branch_id IS NOT NULL);
   ```

2. **Branch Type Seeding**
   ```sql
   -- Ensure WAREHOUSE_DC branch type exists
   INSERT INTO branch_types (code, name_en, name_bn, is_active)
   VALUES ('WAREHOUSE_DC', 'Distribution Center', 'বিতরণ কেন্দ্র', true)
   ON CONFLICT (code) DO NOTHING;
   ```

### Data Integrity
1. **Existing Warehouse Migration**
   - Create Branch records for existing Warehouses
   - Link InventoryLocations to new Branch records
   - Migrate staff assignments to BranchMember

2. **Validation Rules**
   - Ensure warehouse branches have required capabilities
   - Validate warehouse-specific settings in featuresJson
   - Maintain referential integrity during transition

### Cleanup Timeline
1. **Phase 1** (Immediate): Stop creating separate Warehouse records
2. **Phase 2** (3 months): Migrate existing data to branch-backed
3. **Phase 3** (6 months): Remove Warehouse model dependencies
4. **Phase 4** (12 months): Drop Warehouse table (optional)

---

## QA Checklist

### Functional Testing
- [ ] Owner can create warehouse through branch creation flow
- [ ] Warehouse list shows branch-backed warehouse entries
- [ ] Warehouse detail page loads correct branch data
- [ ] Staff management works through branch member system
- [ ] Inventory locations link to warehouse branch correctly
- [ ] Warehouse operations dashboard functions properly
- [ ] Reports show accurate branch-backed warehouse data

### API Testing
- [ ] `POST /api/v1/warehouse` creates branch with warehouse type
- [ ] `GET /api/v1/warehouse` returns branch-backed warehouse list
- [ ] `GET /api/v1/warehouse/:id` resolves to correct branch data
- [ ] Staff endpoints route through branch member system
- [ ] Location linking updates branch inventory locations
- [ ] Existing warehouse API responses unchanged (compatibility)

### Data Integrity Testing
- [ ] No duplicate warehouse/branch records created
- [ ] Existing warehouse data accessible via branch queries
- [ ] Staff assignments migrated correctly to branch members
- [ ] Inventory locations linked to correct branch
- [ ] Audit trails preserved during migration
- [ ] Foreign key relationships maintained

### UI/UX Testing
- [ ] Warehouse menu navigates to filtered branch list
- [ ] "New Warehouse" redirects to branch creation with preset
- [ ] Warehouse detail pages show branch-backed data
- [ ] Staff management UI works with branch members
- [ ] No broken links or 404 errors in warehouse section
- [ ] Breadcrumbs and navigation consistent
- [ ] Loading states and error handling functional

### Performance Testing
- [ ] Branch queries with warehouse filter perform adequately
- [ ] Warehouse list loads within acceptable time limits
- [ ] No N+1 query issues in branch-backed warehouse operations
- [ ] Database indexes support warehouse branch queries efficiently

---

## Risks and Rollback Notes

### High Risk Areas
1. **Data Loss Risk**: Existing warehouse records during migration
   - **Mitigation**: Backup existing data before migration
   - **Rollback**: Restore from backup if migration fails

2. **API Breaking Changes**: External integrations using warehouse endpoints
   - **Mitigation**: Maintain compatibility layer during transition
   - **Rollback**: Keep deprecated endpoints functional longer

3. **Performance Impact**: Branch queries with warehouse filtering
   - **Mitigation**: Add database indexes for warehouse branch queries
   - **Rollback**: Optimize queries or revert to separate model temporarily

### Medium Risk Areas
1. **Staff Access Disruption**: Role mapping during migration
   - **Mitigation**: Test role mapping thoroughly before deployment
   - **Rollback**: Maintain dual staff assignment systems temporarily

2. **UI Confusion**: Navigation changes for warehouse users
   - **Mitigation**: Gradual UI transition with clear communication
   - **Rollback**: Revert to original warehouse UI if needed

### Low Risk Areas
1. **Audit Trail Gaps**: During transition period
   - **Mitigation**: Log all changes during migration
   - **Rollback**: Manual audit trail reconstruction if needed

### Rollback Strategy
1. **Phase 1 Rollback**: Re-enable separate warehouse creation
2. **Phase 2 Rollback**: Revert UI changes, maintain old navigation
3. **Phase 3 Rollback**: Restore deprecated API endpoints
4. **Data Rollback**: Restore from pre-migration backup

### Monitoring Requirements
- Track API usage of deprecated warehouse endpoints
- Monitor performance of branch-backed warehouse queries
- Alert on data integrity issues during migration
- Log user feedback on warehouse UI changes

---

## Implementation Timeline

### Week 1: Backend Foundation
- Fix duplicate route registration
- Implement warehouse creation through branch flow
- Add branch type validation for warehouses
- Create compatibility layer for existing endpoints

### Week 2: Data Migration
- Run warehouse-to-branch migration script
- Migrate staff assignments to branch members
- Update inventory location relationships
- Validate data integrity

### Week 3: Frontend Implementation
- Create warehouse list page (filtered branches)
- Implement warehouse creation redirect
- Build warehouse detail page with branch data
- Update navigation and routing

### Week 4: Testing & Validation
- Execute comprehensive QA checklist
- Performance testing of branch-backed queries
- User acceptance testing of warehouse workflows
- Documentation updates

---

## Success Metrics

### Technical Metrics
- Zero data loss during warehouse-to-branch migration
- API response times within 10% of baseline performance
- 100% test coverage for warehouse-branch convergence logic
- Zero critical bugs in production after deployment

### Business Metrics
- Warehouse creation workflow completion rate maintained
- Staff productivity in warehouse operations unchanged
- User satisfaction scores for warehouse UI ≥ 4.0/5.0
- Reduced maintenance overhead for warehouse codebase

### Operational Metrics
- Single source of truth for warehouse data achieved
- Duplicate code paths eliminated (warehouse vs branch)
- Simplified onboarding for new warehouse staff
- Consistent RBAC across all location types

---

## Follow-up Recommendations

### Phase 2 Enhancements (Future)
1. **Unified Location Management**: Extend convergence to all location types
2. **Advanced Warehouse Features**: Leverage branch capabilities for warehouse-specific features
3. **Multi-tenant Warehouse**: Support shared warehouses across organizations
4. **Warehouse Analytics**: Enhanced reporting with branch-based data model

### Technical Debt Reduction
1. **Remove Warehouse Model**: Complete elimination after successful migration
2. **Consolidate Staff Systems**: Single staff management system across all location types
3. **Unified Permissions**: Consistent RBAC model for all business locations
4. **API Standardization**: Consistent API patterns for all location operations

### Documentation Updates
1. **API Documentation**: Update warehouse endpoint documentation
2. **User Guides**: Warehouse management through branch interface
3. **Developer Guides**: Branch-based warehouse development patterns
4. **Migration Guides**: For external integrations using warehouse APIs

---

## Conclusion

This convergence plan provides a structured approach to eliminate the duplicate warehouse/branch architecture while maintaining backward compatibility and ensuring zero data loss. The phased implementation minimizes risk while achieving the goal of a single source of truth for all business locations.

The key success factor is treating this as a convergence rather than a migration - leveraging the existing branch infrastructure to support warehouse use cases while gradually deprecating the separate warehouse domain.
