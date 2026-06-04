# Vaccination Billing / Invoice Link Plan

## 1. Goal

Safely extend the branch vaccination "Administer & Deduct Stock" workflow so staff can optionally create or attach a billable clinic charge after vaccine administration, without breaking:

- the existing branch vaccination page
- the standalone vaccination flow
- the staff patient Vaccines tab
- the current stock deduction transaction

The billing link should use the existing clinic billing and order system, remain branch-scoped, and avoid double stock deduction.

## 2. Existing Billing System

### Backend services and routes found

Current clinic billing already exists in `src/api/v1/modules/clinic/billing.service.ts` and is exposed through `src/api/v1/modules/clinic/clinic.routes.ts` / `clinic.controller.ts`.

Existing clinic billing routes:

- `GET /api/v1/clinic/branches/:branchId/visits/:visitId/billing-summary`
- `GET /api/v1/clinic/branches/:branchId/visits/:visitId/orders`
- `GET /api/v1/clinic/branches/:branchId/visits/:visitId/payment-status`
- `POST /api/v1/clinic/branches/:branchId/visits/:visitId/create-invoice`
- `GET /api/v1/clinic/branches/:branchId/prescriptions/:prescriptionId/order-lines`
- `GET /api/v1/clinic/branches/:branchId/treatment-billing/:courseId/summary`
- `POST /api/v1/clinic/branches/:branchId/treatment-billing/:courseId/create-bill`

Current billing service capabilities:

- `getBillingSummaryForVisit(visitId, branchId)`
- `getVisitServicePaymentStatus(visitId, branchId)`
- `createInvoiceFromVisit(visitId, branchId, data, createdByUserId)`
- `getOrdersForVisit(visitId, branchId)`
- `getPrescriptionItemsForOrder(prescriptionId)`
- `getTreatmentBillingSummary(courseId, branchId)`
- `createTreatmentDayBill(courseId, branchId, data, createdByUserId)`

### Order / invoice system found

The main billable object is `Order`, not a standalone clinic charge model.

Relevant Prisma models:

- `Order`
  - branch-scoped
  - optional `customerId`
  - optional `visitId`
  - `orderSource` supports `CLINIC`
  - `paymentStatus` supports `PENDING`, `COMPLETED`, `FAILED`, `REFUNDED`
- `OrderItem`
  - supports either product-based lines or service-based lines via `serviceId`
- `ClinicInvoice`
  - linked `1:1` to `Order`
  - currently focused on case/surgery financial breakdown, not vaccination
- `OrderPayment`
  - split / tracked payment rows
- `PosInvoice`
  - POS print invoice layer, mainly for POS flows
- `Service`
  - branch-scoped catalog row
  - includes `category`, `price`, discount flags, tax config, payment gate settings
- `ServicePricingVariant`
  - species/sex-specific service pricing
- `ServiceDelivery`
  - links a visit service delivery to an order and payment verification state

### Orders / POS services found

`src/api/v1/modules/orders/orders.service.ts` provides:

- `createOrder(...)`
- `processPayment(...)`
- `updateOrderStatus(...)`
- `createOrderPaymentsInTx(...)`

Important behavior:

- `createOrder(...)` creates the `Order` and `OrderItem` rows.
- `processPayment(...)` updates `paymentMethod`, `paymentStatus`, and promotes `Order.status` to `CONFIRMED` when payment completes.
- `orders.controller.ts` performs stock deduction for product lines when orders are created through `/api/v1/orders`, but clinic billing flows currently call `orderService.createOrder(...)` directly through `billing.service.ts`, so clinic invoice creation does not automatically repeat inventory deduction.

`src/api/v1/modules/pos/pos.service.ts` shows a richer checkout flow with:

- order totals
- payment capture
- split payments
- POS invoice generation

That POS path is useful as a reference, but it is a higher-scope integration than this vaccination billing pass should attempt.

### Service catalog / pricing / discounts found

The existing billing system already has the right pricing primitives:

- `Service.category` includes `VACCINATION`
- `Service.price`
- `ServicePricingVariant` for species/sex pricing
- `Service.allowDiscount`
- `Service.maxDiscountPct`
- `Service.discountNeedsApproval`
- `Service.ownerDiscountEligible`
- branch discount policy and audit routes already exist under clinic routes

### Existing frontend billing helpers found

In `D:\BPA_Data\bpa_web\lib\api.ts` there are already helpers for:

- `staffClinicBillingSummary(...)`
- `staffClinicVisitOrders(...)`
- `staffClinicVisitPaymentStatus(...)`
- `staffClinicCreateInvoice(...)`
- `staffClinicServices(...)`

Existing UI references show there is already a branch billing screen:

- `/staff/branch/[branchId]/clinic/billing`
- several visit/case pages deep-link into `/clinic/billing?visitId=...`

The injection token UI already uses a practical optional billing pattern:

- billing toggle
- branch service selection
- service fee input
- payment method input
- clear separation between clinical action and billing action

That is the best existing frontend pattern to mirror for vaccination.

## 3. Current Vaccination Administer Flow

The current stock-backed vaccination flow is:

- `POST /api/v1/clinic/branches/:branchId/vaccinations/administer`

Current backend behavior in `vaccination.service.ts`:

1. validate `branchId`, `petId`, `vaccineTypeId`, `batchId`
2. validate branch and vaccine type exist
3. inside `prisma.$transaction(...)`
   - re-read the selected `BranchItemBatch`
   - ensure branch match
   - ensure batch is `ACTIVE`
   - ensure batch is not expired
   - ensure `remainingQty >= 1`
   - create `Vaccination`
   - store only inventory snapshot text:
     - `batchNumber`
     - `manufacturer`
   - call `recordClinicalLedgerEntry(...)`
   - deduct `quantityDelta = -1`
   - use `refType = "VACCINATION"`
   - use `refId = String(vaccination.id)`

Current response returns:

- `vaccination`
- `stock.batchId`
- `stock.remainingQty`
- `stock.ledgerId`

Current limitations:

- no invoice/order creation
- no `orderId` / `invoiceId` on `Vaccination`
- no direct billing reference in the vaccination record
- no visit selection on the branch vaccination page today

## 4. Billing Design Options

### A. Create clinic invoice/order immediately inside administer transaction

Idea:

- extend `POST /vaccinations/administer`
- create `Vaccination`
- deduct stock
- create clinic `Order` / invoice in the same request

Pros:

- one-click workflow
- server can return one combined vaccination + stock + billing result
- easier for staff when vaccination should always be chargeable

Cons:

- much higher partial-failure risk
- billing validation needs extra data: customer, service/price, maybe visit
- a billing error could block a completed clinical action
- order creation semantics differ from stock deduction semantics
- payment capture / discount / invoice formatting can expand scope quickly

Risk:

- medium to high

### B. Create pending billable item/charge and let staff convert to invoice later

Idea:

- create a lightweight pending charge record from vaccination
- billing screen later converts it into a full order/invoice

Pros:

- clean separation between clinical action and checkout
- easier to support review before billing
- avoids forcing payment context during administration

Cons:

- current system does not appear to have a generic pending clinic charge model
- would likely require new schema/modeling work
- introduces a second billing abstraction beside `Order`

Risk:

- high for current phase because it likely needs schema changes

### C. Attach vaccination to an existing visit/appointment invoice if provided

Idea:

- if staff supplies `visitId`, add a vaccination service line to that visit’s clinic invoice flow
- reuse the visit billing path already in place

Pros:

- best alignment with existing clinic billing structure
- visit already anchors patient/customer/branch context
- existing billing UI and APIs are already visit-aware
- easiest place to surface payment status later

Cons:

- branch vaccination page does not currently require or manage visit selection
- some vaccinations may happen outside an active visit workflow
- still needs a decision for no-visit cases

Risk:

- low to medium

## 5. Recommended Low-Risk Approach

Recommended approach for the current system:

Use a service-based clinic billing link, not a product-based sale, and prefer visit-linked invoice creation when a valid `visitId` is available. For no-visit cases, allow creation of a standalone unpaid clinic order only as an explicit optional branch workflow.

### Why this is safest

1. The current billing system is already centered on `Order` and visit billing.
2. `Service.category = VACCINATION` already exists, so the billable charge can be modeled as a service line.
3. The stock deduction already happens in the clinical stock ledger transaction. Billing should not create a second inventory movement.
4. A service-line charge avoids confusion between:
   - vaccine inventory cost / stock batch
   - customer-facing clinical charge
5. Visit-linked billing fits existing summary, order listing, and payment-status APIs.

### Concrete recommendation

- Billing line type:
  - use `serviceId` on `OrderItem`
  - do not bill vaccination as a product line in this phase
- Preferred price source:
  - selected branch `Service` row in category `VACCINATION`
  - fallback manual `unitPrice` only when explicitly allowed by the server
- Preferred context:
  - if `visitId` is supplied and valid for the same branch/pet/customer, create or attach billing to that visit
  - if `visitId` is not supplied, allow optional standalone `Order` with `orderSource = CLINIC`, `customerId`, and a vaccination note, but keep it unpaid by default
- Payment handling:
  - create the order with `paymentStatus = PENDING`
  - do not merge POS checkout into vaccination administration in the first billing pass
- Failure handling:
  - keep vaccination + stock deduction authoritative
  - billing should be a separate controlled step in server logic, or a post-clinical branch inside the endpoint with clear rollback policy

### Strong safety rule

Do not create a product-based order line for the vaccine stock item in this phase.

Reason:

- stock has already been deducted through `recordClinicalLedgerEntry(...)`
- product billing paths are easy to confuse with inventory-selling flows
- even where direct clinic billing currently bypasses automatic order stock deduction, using product lines now creates future double-deduction risk when billing logic evolves

## 6. Required Backend API Changes

### Recommended API shape

Safer than replacing the current stock-backed endpoint is to extend it with an optional billing block while keeping billing optional and clearly separated in validation and response.

Recommended request target:

- `POST /api/v1/clinic/branches/:branchId/vaccinations/administer`

Recommended additional request body:

```json
{
  "petId": 123,
  "vaccineTypeId": 4,
  "batchId": 77,
  "administeredAt": "2026-05-01T10:30:00.000Z",
  "nextDueDate": "2027-05-01T00:00:00.000Z",
  "notes": "Annual rabies vaccine",
  "billing": {
    "enabled": true,
    "serviceId": 56,
    "unitPrice": 1200,
    "quantity": 1,
    "discount": {
      "type": "PERCENT",
      "value": 0
    },
    "visitId": 9001,
    "appointmentId": null,
    "existingInvoiceId": null,
    "customerId": 321,
    "paymentMode": null
  }
}
```

### If a separate endpoint is chosen instead

Lowest-risk implementation alternative:

- keep `POST /vaccinations/administer` unchanged for clinical + stock work
- add:
  - `POST /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/create-charge`

That split is safer operationally, but it is a two-step UX. If the product goal is "one action from the vaccination page", the UI can still chain the two calls.

### Recommended validation rules

Base clinical validations remain unchanged.

If `billing.enabled !== true`:

- no billing validation

If `billing.enabled === true`:

- `serviceId` required
- `quantity` default `1`, must stay `1` in this phase
- `unitPrice` required unless server decides to use branch service price automatically
- if `visitId` provided:
  - visit must exist
  - visit must belong to same branch
  - visit must belong to same pet
  - visit patient/customer must match selected pet owner
- `customerId` required if no valid visit-owned customer can be derived
- `serviceId` must belong to the same branch
- service should be active
- service should preferably be in `ServiceCategory.VACCINATION`
- `existingInvoiceId` should be rejected in Phase 1 unless a reliable append-to-order path is confirmed
- `paymentMode` should be optional and ignored in Phase 1 unless using existing order payment flow intentionally

### Recommended permission rules

- clinical action:
  - keep `clinic.emr.write`
- billing add-on:
  - require either:
    - `clinic.billing.write`
    - or a route-level OR of `clinic.emr.write` and `clinic.billing.write` with an additional in-handler check when `billing.enabled === true`

Safer rule:

- keep route accessible to `clinic.emr.write`
- inside the handler, reject `billing.enabled === true` unless the user also has `clinic.billing.write`

### Recommended response shape

```json
{
  "success": true,
  "data": {
    "vaccination": {},
    "stock": {
      "batchId": 77,
      "remainingQty": 9,
      "ledgerId": 456
    },
    "billing": {
      "created": true,
      "orderId": 12345,
      "orderNumber": "BPA-XXXX",
      "invoiceNumber": null,
      "paymentStatus": "PENDING",
      "visitId": 9001,
      "serviceId": 56,
      "unitPrice": 1200,
      "quantity": 1,
      "totalAmount": 1200
    }
  }
}
```

If billing is disabled:

```json
{
  "billing": {
    "created": false
  }
}
```

## 7. Transaction Design

### Recommended coordination model

There are two safe patterns.

#### Pattern 1: single request, two internal phases

1. run the existing vaccination + stock transaction first
2. after successful commit, create the billing order
3. return both results

This is the recommended low-risk path.

Reason:

- the clinical action and stock deduction are the authoritative medical record
- billing should not block clinical recording if pricing or order validation fails

#### Pattern 2: one wide DB transaction for all three operations

1. create vaccination
2. deduct stock
3. create order
4. optional payment rows
5. commit all or rollback all

This is more atomic on paper but riskier for operations and support, because a billing problem can erase a completed vaccination administration event.

### Recommended server behavior

When billing is enabled:

1. verify branch access
2. verify pet branch visibility
3. verify vaccine type
4. verify selected batch
5. perform vaccination + stock deduction transaction
6. derive billing owner/customer
7. validate service and price inputs
8. create a clinic order using a service-only line
9. return billing summary

### Rollback guidance

Recommended policy:

- if vaccination or stock deduction fails:
  - rollback the clinical transaction
  - do not create billing
- if vaccination + stock deduction succeeds but billing fails:
  - keep vaccination and stock result committed
  - return success for the clinical action
  - return a billing error block or partial-success status

Example partial-success shape:

```json
{
  "success": true,
  "data": {
    "vaccination": {},
    "stock": {},
    "billing": {
      "created": false,
      "error": "Billing service row not found for this branch"
    }
  }
}
```

This is safer for patient care and support workflows.

### Billing creation details

For Phase 1 billing creation:

- use `orderService.createOrder(...)` or a small branch-safe wrapper in clinic billing service
- create `orderSource = "CLINIC"`
- create exactly one `OrderItem` with `serviceId`
- set `quantity = 1`
- set `price = unitPrice`
- prefer `visitId` when available
- keep `paymentStatus = PENDING`
- do not auto-run POS invoice creation
- do not auto-run payment capture

## 8. Data Model Gap

Current `Vaccination` fields are:

- `petId`
- `vaccineTypeId`
- `administeredAt`
- `nextDueDate`
- `batchNumber`
- `manufacturer`
- `certificateToken`
- `notes`

Current gaps:

- no `orderId`
- no `invoiceId`
- no `serviceId`
- no billing status snapshot
- no direct join to clinic invoice / POS invoice / order payment

### Minimum safe approach now

Without schema changes, the safest temporary approach is:

- return billing metadata in the API response
- include vaccination identifiers inside `Order.notes`
- when possible, rely on `visitId` linkage on the order for future lookup

Recommended temporary order note example:

- `Vaccination #123 | Pet #45 | VaccineType #4 | Batch RAB-2026-01`

This is only a traceability aid, not a durable relational link.

### Future V2 fields

Future schema work should consider either:

- nullable fields on `Vaccination`
  - `orderId`
  - `clinicInvoiceId`
  - `billingStatus`
- or a dedicated junction table such as `VaccinationBillingLink`

Do not add those in this phase.

## 9. Frontend UI Plan

The branch vaccination page should keep the current stock-backed section and add an optional billing panel beneath it.

### Recommended UI changes

- keep the manual no-stock form separate
- keep the stock-backed administration form separate
- add a billing toggle under the stock-backed form:
  - `Create clinic charge`
- when enabled, show:
  - vaccination service selector
  - optional visit selector or visit ID field
  - unit price field
  - quantity shown as fixed `1`
  - customer summary derived from selected pet owner
  - optional payment method field only if the backend phase supports it

### Billing data source on frontend

Reuse existing APIs/helpers where possible:

- `staffClinicServices(branchId)` for branch services
- `staffClinicBillingSummary(branchId, visitId)` if visit mode is used
- `staffClinicVisitOrders(branchId, visitId)` for already-billed context
- `staffClinicVisitPaymentStatus(branchId, visitId)` for status hints

### Recommended UX behavior

- if no vaccination service is configured:
  - show warning
  - allow clinical administration without billing
- if visit-linked mode is chosen:
  - verify visit belongs to selected pet before enabling submit
- after successful administration:
  - refresh vaccination history
  - refresh next due
  - refresh dashboard
  - if billing created, show:
    - order number
    - payment status
    - link to billing page

### UI copy / safety expectations

- do not imply stock item price equals customer charge
- clearly label the billing section as optional
- clearly show when no invoice was created
- keep the "Administer & Deduct Stock" action understandable even when billing is off

## 10. Risks

- duplicate billing if the request is retried after vaccination succeeds but billing fails mid-response
- price mismatch between service catalog price and manually entered price
- confusion between stock item cost and service charge
- partial success where vaccination succeeds but billing does not
- no direct invoice/order reference on the current `Vaccination` model
- branch mismatch between pet, visit, service, and billing context
- using product order lines could cause future double stock deduction
- discounts, taxes, and memberships may not be applied consistently if bypassed
- POS checkout logic and clinic invoice logic may conflict if mixed too early
- attaching to an existing invoice/order without a clear append policy could duplicate or corrupt billing intent

## 11. Acceptance Criteria

Future implementation should satisfy all of the following:

1. Staff can administer a vaccine with stock deduction exactly as today when billing is off.
2. Billing is optional and does not break clinical administration.
3. When billing is on, the backend validates branch, pet, customer, and service ownership consistently.
4. Billing uses a service-based clinic charge, not a product inventory sale, in this phase.
5. If `visitId` is provided, the created billing record is branch-correct and visit-linked.
6. If vaccination or stock deduction fails, no billing record is created.
7. If billing fails after successful clinical commit, the response clearly reports billing failure without hiding the completed vaccination.
8. Frontend shows order/payment summary when billing succeeds.
9. Existing standalone vaccination flows remain compatible.
10. Existing staff patient Vaccines tab remains compatible.

## 12. Recommended Implementation Phases

### Phase A: read billing/service/pricing options

- add read-only service options for the vaccination page
- filter branch services to `ServiceCategory.VACCINATION` where possible
- optionally read visit billing status when a visit is supplied

### Phase B: optional create charge/invoice from administer

- extend the administer endpoint with an optional `billing` block
- create a service-only `CLINIC` order after successful clinical commit
- keep payment status `PENDING`

### Phase C: UI billing section

- add billing toggle
- add vaccination service selector
- add visit selector / visit ID input
- add unit price field with service default preload
- show billing result card after submit

### Phase D: payment status and invoice view link

- show created order number
- deep-link to `/staff/branch/[branchId]/clinic/billing`
- optionally surface visit payment status / existing orders when visit-linked

### Phase E: V2 schema invoice reference and audit hardening

- add durable vaccination-to-order linkage
- add idempotency / retry guard for duplicate billing
- add audit fields / billing snapshots
- consider nullable `orderId` or a junction table

## 13. Exact Next Implementation Command

Implement the vaccination billing Phase A-C from `D:\BPA_Data\backend-api\docs\VACCINATION_BILLING_INVOICE_LINK_PLAN_2026-04-30.md`: extend the branch vaccination administer workflow with an optional service-based clinic billing block, prefer visit-linked `CLINIC` order creation when `visitId` is provided, keep stock deduction authoritative, update the branch vaccination page billing UI, and do not add migrations or product-based vaccine order lines.
