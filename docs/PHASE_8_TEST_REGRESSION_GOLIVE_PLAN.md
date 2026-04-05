# Phase 8 — Final Test, Regression & Go-Live Readiness Plan

**Project:** BPA Warehouse & Internal Delivery System
**Phase:** 8 (Final hardening, QA, deployment readiness)
**Date:** 2026-04-04
**Related docs:** `VENDOR_RECEIVE_BRANCH_CONFIRMATION_PRICING_GOVERNANCE_PLAN.md`, `WAREHOUSE_INTERNAL_DELIVERY_AUDIT_AND_GAP_REPORT.md`

---

## 1. System scope & completion status

### 1.1 Project boundaries

**In scope:**
- Warehouse procurement (PO → vendor receive → GRN → stock)
- Branch replenishment (stock request → allocation → pick → dispatch → branch receive)
- Pricing governance (retail discount approvals with expiry/consumption tracking)
- Controlled receiving (draft sessions → manager confirmation → ledger posting)
- Transaction safety (POS sales, vendor/branch receive confirmation)
- Operational visibility (exception summaries, pending confirmations)

**Out of scope:**
- Customer home delivery (POD is internal proof only)
- Multi-org consolidation workflows
- Advanced wave picking / multi-warehouse allocation
- External vendor portals

### 1.2 Implementation status

| Component | Status | Confidence | Notes |
|-----------|--------|------------|-------|
| **Core data model** | ✅ Complete | High | Ledger + lot balances, GRN linking, dispatch lifecycle |
| **POS transaction safety** | ✅ Complete | High | Single DB transaction for payment + discount + stock |
| **Vendor receive control** | ✅ Complete | High | Session → confirmation → GRN posting with locks |
| **Branch receive control** | ✅ Complete | High | Session → confirmation → dispatch receive with locks |
| **Pricing governance** | ✅ Complete | High | Approval expiry (7d), consumption tracking, POS integration |
| **Operational APIs** | ✅ Complete | Medium | Exception summary, pending details, barcode lookup |
| **UI integration** | ✅ Complete | Medium | Owner/staff banners, bulk receive barcode field |
| **Notifications** | ✅ Complete | Medium | In-app notifications to org owner on receive submissions |
| **RBAC alignment** | ⚠️ Needs review | Medium | Permission keys vs route guards need final validation |
| **Legacy deprecation** | ⚠️ Partial | Low | StockTransfer/WTO still active, deprecation banners added |

---

## 2. Critical verification checklist

### 2.1 Transaction safety (CRITICAL)

- [ ] **POS sale transaction integrity**
  - Payment processing + discount consumption + stock adjustment in single transaction
  - Rollback on any step failure
  - No double-consumption of approvals on retry

- [ ] **Vendor receive confirmation**
  - GRN row locked during receive processing
  - Duplicate confirmation attempts rejected
  - Stock ledger entries atomic with GRN status update

- [ ] **Branch receive confirmation**
  - Dispatch receive session locked during processing
  - Status validation before ledger posting
  - Consistent stock balances at source and destination

### 2.2 Pricing governance (CRITICAL)

- [ ] **Retail discount approval lifecycle**
  - Approval expires after 7 days from review
  - Price mismatch detection and rejection
  - Approval tied to specific order/line items
  - No reuse of consumed approvals

### 2.3 Data consistency (HIGH)

- [ ] **Ledger integrity**
  - All stock movements create corresponding ledger entries
  - TRANSFER_OUT at source matches TRANSFER_IN at destination
  - No orphaned stock adjustments

- [ ] **Status synchronization**
  - Dispatch status aligns with ledger entries
  - Stock request status updates on receive completion
  - GRN status reflects actual posting state

### 2.4 Permission enforcement (HIGH)

- [ ] **Route-level authorization**
  - Confirmation endpoints require appropriate permissions
  - Owner-only operations properly gated
  - Staff role boundaries enforced

---

## 3. Regression test scenarios

### 3.1 Core business flows

**Scenario A: Branch replenishment (happy path)**
1. Branch creates stock request for low-stock items
2. Warehouse manager approves and creates allocation plan
3. Picking staff generates pick list and completes picking
4. Dispatch staff creates and sends dispatch
5. Branch staff receives dispatch and confirms quantities
6. Stock balances updated at both locations
7. Stock request marked as fulfilled

**Scenario B: Vendor procurement (happy path)**
1. Warehouse creates purchase order for vendor
2. Vendor delivers goods to warehouse
3. Receiving staff creates draft GRN in receive session
4. Manager reviews and confirms receive session
5. Stock posted to inventory with proper lot tracking
6. PO status updated to reflect received quantities

**Scenario C: POS sale with discount (happy path)**
1. Manager approves retail discount for specific customer/order
2. Seller creates POS sale with approved discount
3. Payment processed successfully
4. Discount approval consumed (cannot be reused)
5. Stock adjusted for sold items
6. Order marked as completed

### 3.2 Error conditions

**Scenario D: Duplicate confirmation attempts**
1. Receive session submitted for confirmation
2. Manager attempts to confirm twice
3. Second attempt should be rejected with clear error
4. Stock ledger should have only one set of entries

**Scenario E: Expired discount approval**
1. Manager approves discount for customer
2. Wait 8 days (past 7-day expiry)
3. Attempt POS sale with expired approval
4. Sale should be rejected with expiry message

**Scenario F: Insufficient stock dispatch**
1. Create dispatch for quantity exceeding available stock
2. Attempt to send dispatch
3. Should be rejected with stock availability error

### 3.3 Permission boundary tests

**Scenario G: Unauthorized confirmation**
1. Branch staff (non-manager) attempts to confirm receive session
2. Should receive 403 Forbidden response
3. Session should remain in submitted state

**Scenario H: Cross-org access attempt**
1. User from Org A attempts to access Org B's inventory data
2. Should receive 403 Forbidden or filtered results
3. No data leakage between organizations

---

## 4. Manual QA scenarios

*Note: These scenarios require manual testing as automation would be complex/expensive*

### 4.1 UI workflow validation

**QA-1: Exception summary banner display**
- Create test data with pending confirmations
- Verify owner inventory page shows warning banner
- Verify staff warehouse page shows org-level summary
- Confirm banner links navigate to correct pages

**QA-2: Barcode scanning in bulk receive**
- Use bulk receive page with test barcode
- Verify variant lookup works for org-scoped catalog
- Confirm scanned items populate grid correctly
- Test with invalid/non-existent barcodes

**QA-3: Notification delivery**
- Submit vendor receive session for confirmation
- Verify org owner receives in-app notification
- Submit dispatch receive session for confirmation
- Verify notification deduplication works

### 4.2 Role-based access validation

**QA-4: Owner vs staff access patterns**
- Test owner access to all inventory operations
- Test warehouse manager access to confirmations
- Test branch staff access limitations
- Verify receiving staff can create but not confirm sessions

**QA-5: Multi-location access control**
- Test user access to assigned locations only
- Verify location-scoped data filtering
- Test warehouse assignment enforcement

### 4.3 Data integrity spot checks

**QA-6: Stock balance reconciliation**
- Complete full branch replenishment cycle
- Manually verify stock balances at source and destination
- Check ledger entries for completeness and accuracy
- Confirm lot tracking through transfer process

**QA-7: Pricing governance enforcement**
- Create discount approval with specific price/customer
- Attempt sale with different price → should fail
- Attempt sale with different customer → should fail
- Verify approval consumption prevents reuse

---

## 5. Migration & seed checklist

### 5.1 Database preparation

- [ ] **Migration integrity check**
  ```bash
  cd D:\BPA_Data\backend-api
  node scripts/check-migration-integrity.js
  ```

- [ ] **Apply pending migrations**
  ```bash
  npx prisma migrate deploy
  ```

- [ ] **Verify schema alignment**
  ```bash
  npx prisma db pull
  # Compare with existing schema.prisma
  ```

### 5.2 Seed data validation

- [ ] **Role and permission seeding**
  ```bash
  npm run seed:roles-permissions
  ```
  - Verify warehouse roles: WAREHOUSE_MANAGER, RECEIVING_STAFF, etc.
  - Confirm permission keys align with route requirements
  - Check branch role assignments

- [ ] **Test organization setup**
  - Create test org with owner user
  - Create test branches with warehouse assignments
  - Verify staff user assignments and permissions

### 5.3 Configuration validation

- [ ] **Environment variables**
  - `BLOCK_LEGACY_TRANSFERS` → set to `false` initially
  - Database connection strings
  - Authentication/session configuration
  - File upload paths for documents

- [ ] **Feature flags**
  - Pricing governance enabled
  - Controlled receiving enabled
  - Notification system active

---

## 6. Go-live deployment checklist

### 6.1 Pre-deployment validation

- [ ] **Code compilation**
  ```bash
  # Backend
  cd D:\BPA_Data\backend-api
  npx tsc --noEmit

  # Frontend
  cd D:\BPA_Data\bpa_web
  npx tsc --noEmit
  ```

- [ ] **Test suite execution**
  ```bash
  cd D:\BPA_Data\backend-api
  npm test
  # Focus on: pricing, receive, transaction tests
  ```

- [ ] **Route ordering validation**
  - Verify `/api/v1/inventory/lookup/variant-by-barcode` comes before `/:id`
  - Check for route conflicts in all modules
  - Confirm middleware ordering

### 6.2 Deployment sequence

1. **Database migration**
   ```bash
   npx prisma migrate deploy
   node scripts/check-migration-integrity.js
   ```

2. **Backend deployment**
   - Deploy API server with new transaction-safe endpoints
   - Verify health check endpoints respond
   - Check logs for startup errors

3. **Frontend deployment**
   - Deploy updated UI with exception banners
   - Verify static assets load correctly
   - Test authentication flow

4. **Seed critical data**
   ```bash
   npm run seed:roles-permissions
   # Only if not already present in production
   ```

### 6.3 Smoke test sequence

**ST-1: Warehouse receive smoke test**
- [ ] Create test PO for vendor
- [ ] Submit receive session with test quantities
- [ ] Manager confirms receive session
- [ ] Verify stock balances updated
- [ ] Check GRN creation and status

**ST-2: Branch receive smoke test**
- [ ] Create test stock request from branch
- [ ] Process through allocation and picking
- [ ] Send dispatch to branch
- [ ] Branch submits receive session
- [ ] Manager confirms receive
- [ ] Verify stock transferred correctly

**ST-3: POS pricing smoke test**
- [ ] Create retail discount approval
- [ ] Process POS sale with approved discount
- [ ] Verify approval consumed
- [ ] Attempt reuse → should fail
- [ ] Test expired approval rejection

**ST-4: Exception summary smoke test**
- [ ] Create pending receive sessions
- [ ] Verify exception summary API returns correct counts
- [ ] Check owner inventory banner displays
- [ ] Confirm staff warehouse banner shows org data

**ST-5: Print documents smoke test**
- [ ] Generate pick list PDF
- [ ] Generate dispatch challan PDF
- [ ] Generate GRN document PDF
- [ ] Verify all documents render correctly

**ST-6: Notification smoke test**
- [ ] Submit receive session for confirmation
- [ ] Verify org owner receives notification
- [ ] Check notification deduplication
- [ ] Test notification clearing on confirmation

---

## 7. Rollback procedures

### 7.1 Immediate rollback triggers

- **Database corruption:** Inconsistent ledger entries or stock balances
- **Authentication failure:** Users unable to access system
- **Critical transaction failure:** POS sales failing or double-charging
- **Permission escalation:** Users accessing unauthorized data

### 7.2 Rollback steps

1. **Application rollback**
   - Revert to previous backend deployment
   - Revert to previous frontend deployment
   - Restore previous configuration files

2. **Database rollback** (if migrations applied)
   ```bash
   # Only if safe migration rollback is possible
   npx prisma migrate reset --skip-seed
   # Restore from backup if necessary
   ```

3. **Data consistency check**
   - Verify stock balances are accurate
   - Check for orphaned transactions
   - Validate user permissions

### 7.3 Post-rollback validation

- [ ] All critical business flows working
- [ ] No data corruption or loss
- [ ] User access patterns restored
- [ ] Audit trail intact

---

## 8. Production monitoring checklist

### 8.1 Key metrics to monitor

**Business metrics:**
- Daily receive confirmations (vendor and branch)
- POS sales with discount approvals
- Stock request fulfillment rate
- Exception summary counts

**Technical metrics:**
- Transaction failure rates
- Database lock contention
- API response times for confirmation endpoints
- Notification delivery success rate

**Error monitoring:**
- Failed receive confirmations
- Duplicate transaction attempts
- Permission denied errors
- Stock balance inconsistencies

### 8.2 Alert thresholds

- **Critical:** Transaction failure rate > 1%
- **High:** Exception summary total > 50 items
- **Medium:** Confirmation processing time > 30 seconds
- **Low:** Daily notification volume outside normal range

---

## 9. Final readiness assessment

### 9.1 Go/No-Go criteria

**GO criteria (all must be met):**
- [ ] All critical verification tests pass
- [ ] No blocking compilation or runtime errors
- [ ] Database migration completes successfully
- [ ] Smoke tests pass in staging environment
- [ ] Rollback procedures tested and validated
- [ ] Production monitoring configured

**NO-GO criteria (any present):**
- Transaction safety tests failing
- Data corruption in test scenarios
- Critical permission bypasses discovered
- Rollback procedures untested or failing

### 9.2 Risk assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|---------|------------|
| Transaction rollback failure | Low | Critical | Extensive testing, verified rollback procedures |
| Permission bypass | Low | High | Role validation tests, audit logging |
| Stock balance inconsistency | Medium | High | Ledger reconciliation checks, monitoring alerts |
| Legacy system confusion | High | Medium | Clear deprecation messaging, training materials |

### 9.3 Success criteria (30 days post-launch)

- Zero critical transaction failures
- < 5% of users attempting legacy transfer flows
- Exception summary consistently under 20 items
- No security incidents related to permission bypasses
- Positive feedback on controlled receive workflow

---

## 10. Outstanding items & technical debt

### 10.1 Known limitations

- **Legacy system deprecation:** StockTransfer/WarehouseTransferOrder still functional but not recommended
- **Multi-org staff:** Some UI elements may not show org-scoped data correctly
- **Automated testing:** Complex business flows require manual QA
- **Performance:** Large-scale concurrent confirmations not load tested

### 10.2 Future enhancements

- **Phase 9:** Complete legacy system removal
- **Phase 10:** Advanced wave picking and multi-warehouse allocation
- **Phase 11:** External vendor portal integration
- **Phase 12:** Advanced analytics and forecasting

### 10.3 Maintenance requirements

- **Monthly:** RBAC alignment audit between permissions and routes
- **Quarterly:** Stock balance reconciliation across all locations
- **Annually:** Full security audit of confirmation workflows

---

**Document status:** Ready for final validation
**Next action:** Execute verification checklist and smoke tests
**Owner:** Development team
**Approver:** Product owner + Operations manager
