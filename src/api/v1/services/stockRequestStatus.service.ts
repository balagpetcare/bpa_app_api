/**
 * Stock Request Status Derivation Service
 *
 * Canonical single source of truth for stock request status logic and state transitions.
 * Encapsulates state machine rules and derived status computation.
 *
 * **Conceptual lifecycle** (enterprise dispatch + receive truth):
 * REQUESTED → APPROVED → ALLOCATED → PARTIALLY_DISPATCHED → DISPATCHED → PARTIALLY_RECEIVED → RECEIVED → CLOSED
 *
 * **DB mapping** (Prisma `StockRequestStatus` — no separate ALLOCATED value today):
 * - REQUESTED ≈ SUBMITTED / OWNER_REVIEW
 * - APPROVED = approved + allocation plan confirmed (reserved stock)
 * - ALLOCATED ≈ APPROVED with a CONFIRMED allocation plan (derive in UI via plan + request)
 * - PARTIALLY_DISPATCHED / DISPATCHED / PARTIALLY_RECEIVED / RECEIVED = written from dispatch aggregates
 * - RECEIVED_FULL / RECEIVED_PARTIAL = legacy strings; prefer RECEIVED / PARTIALLY_RECEIVED for new code
 *
 * Terminal: CLOSED, CANCELLED.
 */

export type StockRequestStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "OWNER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "FULFILLED_PARTIAL"
  | "FULFILLED_FULL"
  | "PARTIALLY_DISPATCHED"
  | "DISPATCHED"
  | "RECEIVED_PARTIAL"
  | "RECEIVED_FULL"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

export type AllocationPlanStatus =
  | "DRAFT"
  | "ALLOCATED"
  | "PARTIALLY_ALLOCATED"
  | "FAILED"
  | "CONFIRMED"
  | "PICKING"
  | "PICKED"
  | "DISPATCHED"
  | "CANCELLED"
  | "ON_HOLD"
  | "PARTIALLY_CONFIRMED"
  | "PARTIALLY_DISPATCHED";

export type StockDispatchStatus =
  | "DRAFT"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "PARTIALLY_DELIVERED"
  | "CANCELLED";

/**
 * Resolve derived status based on request state + related entities.
 * This does NOT mutate the database; it returns what the status "should be" given current context.
 *
 * @param request - Current StockRequest record
 * @param allocationPlan - Linked AllocationPlan (if exists)
 * @param dispatches - Linked StockDispatches (if exist)
 * @returns Resolved status
 */
export function deriveRequestStatus(
  request: {
    status: string;
    requestedQtyTotal?: number;
    fulfilledQtyTotal?: number;
    cancelledQtyTotal?: number;
  },
  allocationPlan?: {
    status: string;
    totalAllocatedQty: number | null;
    shortageQty: number | null;
  } | null,
  dispatches?: Array<{ status: string }> | null
): StockRequestStatus {
  const currentStatus = request.status as StockRequestStatus;

  // Terminal states
  if (["CLOSED", "CANCELLED"].includes(currentStatus)) {
    return currentStatus;
  }

  // If plan confirmed (or partially confirmed for multi-source), should be READY_TO_FULFILL unless already dispatched/received
  if (
    allocationPlan?.status === "CONFIRMED" ||
    allocationPlan?.status === "PARTIALLY_CONFIRMED"
  ) {
    if (
      ["DISPATCHED", "RECEIVED_PARTIAL", "RECEIVED_FULL", "RECEIVED", "PARTIALLY_RECEIVED", "PARTIALLY_DISPATCHED"].includes(
        currentStatus
      )
    ) {
      return currentStatus;
    }
    if (currentStatus === "SUBMITTED" || currentStatus === "OWNER_REVIEW") {
      return "APPROVED";
    }
  }

  // Multi-source: plan partially dispatched → SR partially dispatched
  if (allocationPlan?.status === "PARTIALLY_DISPATCHED") {
    return "PARTIALLY_DISPATCHED";
  }

  // If dispatches exist, refine status from dispatch lifecycle (enterprise DO)
  if (dispatches && dispatches.length > 0) {
    const inFlight = (s: string) =>
      s === "CREATED" || s === "PACKED" || s === "IN_TRANSIT" || s === "FAILED";
    const allDelivered = dispatches.every((d) => d.status === "DELIVERED");
    const someDelivered = dispatches.some((d) => d.status === "DELIVERED");
    const anyInTransit = dispatches.some((d) => d.status === "IN_TRANSIT");
    const anyPackedOrCreated = dispatches.some((d) => d.status === "PACKED" || d.status === "CREATED");

    if (allDelivered) {
      return "RECEIVED";
    }
    if (someDelivered) {
      return "PARTIALLY_RECEIVED";
    }
    if (anyInTransit || (anyPackedOrCreated && dispatches.every((d) => inFlight(d.status)))) {
      return "DISPATCHED";
    }
  }

  // Default: return current status
  return currentStatus;
}

/**
 * Check if a state transition is allowed.
 *
 * @param from - Current status
 * @param to - Target status
 * @param context - Additional context (e.g., has allocation plan, has dispatches)
 * @returns { allowed: boolean, reason?: string }
 */
export function canTransitionTo(
  from: StockRequestStatus,
  to: StockRequestStatus,
  context?: {
    hasAllocationPlan?: boolean;
    allocationPlanConfirmed?: boolean;
    hasDispatches?: boolean;
    allLinesAccountedFor?: boolean;
  }
): { allowed: boolean; reason?: string } {
  const ctx = context || {};

  // Terminal states cannot transition
  if (["CLOSED", "CANCELLED"].includes(from)) {
    return { allowed: false, reason: "Cannot transition from terminal state" };
  }

  // Allow cancel from any non-terminal state
  if (to === "CANCELLED") {
    return { allowed: true };
  }

  // Define allowed transitions
  const transitions: Record<string, string[]> = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["OWNER_REVIEW", "APPROVED", "CANCELLED"],
    OWNER_REVIEW: ["APPROVED", "CANCELLED"],
    APPROVED: ["DISPATCHED", "APPROVED", "CANCELLED"],
    FULFILLED_PARTIAL: ["DISPATCHED", "APPROVED", "CANCELLED"],
    PARTIALLY_DISPATCHED: ["DISPATCHED", "APPROVED", "CANCELLED"],
    DISPATCHED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
    PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"],
    RECEIVED: ["CLOSED", "CANCELLED"],
    FULFILLED_FULL: ["DISPATCHED", "CANCELLED"],
    RECEIVED_PARTIAL: ["RECEIVED", "CANCELLED"],
    RECEIVED_FULL: ["CLOSED", "CANCELLED"],
  };

  const allowed = transitions[from]?.includes(to) ?? false;
  if (!allowed) {
    return { allowed: false, reason: `Cannot transition from ${from} to ${to}` };
  }

  // APPROVED after allocation confirm: plan is confirmed in same transaction (allocationPlanConfirmed)
  if (to === "APPROVED" && !ctx.hasAllocationPlan && !ctx.allocationPlanConfirmed) {
    return { allowed: false, reason: "Cannot approve without allocation plan confirmation" };
  }

  if (to === "DISPATCHED" && !ctx.hasDispatches) {
    return { allowed: false, reason: "Cannot mark as dispatched without dispatch records" };
  }

  if (to === "CLOSED" && !ctx.allLinesAccountedFor) {
    return { allowed: false, reason: "Cannot close until all lines are accounted for" };
  }

  return { allowed: true };
}

/**
 * Determine if a request is actionable in warehouse fulfillment queue.
 *
 * @param request - StockRequest with status
 * @param allocationPlan - Linked AllocationPlan (if exists)
 * @returns true if should appear in warehouse queue
 */
export function isWarehouseActionable(
  request: { status: string; requestIntent?: string },
  allocationPlan?: { status: string } | null
): boolean {
  const status = request.status as StockRequestStatus;

  // If plan confirmed, warehouse can pick/dispatch
  if (allocationPlan?.status === "CONFIRMED") {
    return true;
  }

  // If status is APPROVED (semantic: ready to fulfill), warehouse can action
  if (status === "APPROVED") {
    return true;
  }

  // Procurement requests in OWNER_REVIEW may need warehouse review
  if (request.requestIntent === "PROCUREMENT" && status === "OWNER_REVIEW") {
    return true;
  }

  return false;
}

/** Segment so UI/queues can separate clinic→DC transfer fulfillment from warehouse procurement workflows */
export type WarehouseFulfillmentSegment = "INTERNAL_TRANSFER" | "PROCUREMENT";

export function getWarehouseFulfillmentSegment(request: {
  requestIntent?: string | null;
}): WarehouseFulfillmentSegment {
  return request.requestIntent === "PROCUREMENT" ? "PROCUREMENT" : "INTERNAL_TRANSFER";
}

/**
 * Determine if a request is actionable in branch inbound receiving queue.
 *
 * @param request - StockRequest with status
 * @param hasInboundDispatches - Whether there are dispatches in transit to this branch
 * @returns true if should appear in branch inbound queue
 */
export function isBranchInboundActionable(
  request: { status: string },
  hasInboundDispatches: boolean
): boolean {
  const status = request.status as StockRequestStatus;
  if (!hasInboundDispatches) return false;
  // Enterprise: SR often stays APPROVED until receive; inbound PACKED/IN_TRANSIT must still be receivable.
  if (status === "APPROVED") return true;
  return (
    status === "DISPATCHED" ||
    status === "PARTIALLY_RECEIVED" ||
    status === "FULFILLED_PARTIAL" ||
    status === "PARTIALLY_DISPATCHED"
  );
}

/** True when enterprise allocation plan has taken over (legacy flexible fulfill should not mutate). */
export function enterpriseAllocationOwnsRequestLifecycle(
  plan: { status: string } | null | undefined
): boolean {
  if (!plan) return false;
  return [
    "CONFIRMED", "PARTIALLY_CONFIRMED",
    "PICKING", "PICKED",
    "DISPATCHED", "PARTIALLY_DISPATCHED",
  ].includes(plan.status);
}

/**
 * Block owner legacy fulfill / allocation-preview / fulfillAndDispatch when an allocation plan row exists.
 * Default: any plan status other than CANCELLED blocks legacy paths (prevents double mutation vs enterprise pick/dispatch).
 * Escape hatch: set env `ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT=true` to only block when the plan is in
 * CONFIRMED+ lifecycle (same as {@link enterpriseAllocationOwnsRequestLifecycle}).
 */
export function shouldBlockLegacyOwnerFulfillment(
  plan: { status: string } | null | undefined
): boolean {
  if (!plan) return false;
  if (String(process.env.ALLOW_LEGACY_FULFILL_WITH_ALLOCATION_DRAFT || "").toLowerCase() === "true") {
    return enterpriseAllocationOwnsRequestLifecycle(plan);
  }
  return plan.status !== "CANCELLED";
}

/**
 * Get human-readable status label and badge color for UI.
 */
export function getStatusDisplay(status: StockRequestStatus): {
  label: string;
  color: "gray" | "blue" | "yellow" | "green" | "red";
} {
  const displays: Record<
    StockRequestStatus,
    { label: string; color: "gray" | "blue" | "yellow" | "green" | "red" }
  > = {
    DRAFT: { label: "Draft", color: "gray" },
    SUBMITTED: { label: "Submitted", color: "blue" },
    OWNER_REVIEW: { label: "Under Review", color: "blue" },
    APPROVED: { label: "Ready to Fulfill", color: "yellow" },
    REJECTED: { label: "Rejected", color: "red" },
    FULFILLED_PARTIAL: { label: "Partially Fulfilled", color: "yellow" },
    FULFILLED_FULL: { label: "Fulfilled", color: "green" },
    PARTIALLY_DISPATCHED: { label: "Partially Dispatched", color: "yellow" },
    DISPATCHED: { label: "Dispatched", color: "yellow" },
    RECEIVED_PARTIAL: { label: "Partially Received", color: "yellow" },
    RECEIVED_FULL: { label: "Received", color: "green" },
    PARTIALLY_RECEIVED: { label: "Partially Received", color: "yellow" },
    RECEIVED: { label: "Received", color: "green" },
    CLOSED: { label: "Closed", color: "gray" },
    CANCELLED: { label: "Cancelled", color: "red" },
  };

  return displays[status] || { label: status, color: "gray" };
}
