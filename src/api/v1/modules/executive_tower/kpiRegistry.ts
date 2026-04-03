/** Static KPI catalog — used for explain strings and drill-down route hints (owner app). */

export type KpiDomain =
  | "FORECAST"
  | "REPLENISHMENT"
  | "PROCUREMENT"
  | "INBOUND"
  | "FULFILLMENT"
  | "REVERSE"
  | "FINANCE"
  | "SLA"
  | "ALERTS";

export type KpiGrain = "ORG" | "BRANCH" | "WAREHOUSE" | "SKU";

export interface KpiDefinition {
  kpiKey: string;
  domain: KpiDomain;
  grain: KpiGrain;
  label: string;
  explainTemplate: string;
  routeHint: string;
}

export const KPI_REGISTRY: KpiDefinition[] = [
  {
    kpiKey: "FORECAST_LOW_CONFIDENCE_PCT",
    domain: "FORECAST",
    grain: "ORG",
    label: "Low-confidence forecast share",
    explainTemplate: "Share of branch-scoped forecast rows with confidence < 0.35 (AiForecastSnapshot).",
    routeHint: "/owner/inventory/planning/forecast",
  },
  {
    kpiKey: "REPLENISHMENT_CRITICAL_OPEN",
    domain: "REPLENISHMENT",
    grain: "ORG",
    label: "Critical replenishment lines (open)",
    explainTemplate: "Count of OPEN AiReplenishmentSuggestion with severity CRITICAL.",
    routeHint: "/owner/inventory/planning/replenishment",
  },
  {
    kpiKey: "FULFILLMENT_OPEN_STOCK_REQUESTS",
    domain: "FULFILLMENT",
    grain: "ORG",
    label: "Open stock requests",
    explainTemplate: "StockRequest rows not in terminal states (CLOSED, CANCELLED, REJECTED).",
    routeHint: "/owner/inventory/stock-requests",
  },
  {
    kpiKey: "FULFILLMENT_DISPATCH_IN_FLIGHT",
    domain: "FULFILLMENT",
    grain: "ORG",
    label: "Dispatches in flight",
    explainTemplate: "StockDispatch with status CREATED, PACKED, or IN_TRANSIT.",
    routeHint: "/owner/inventory/stock-requests",
  },
  {
    kpiKey: "FULFILLMENT_WTO_PIPELINE",
    domain: "FULFILLMENT",
    grain: "ORG",
    label: "Warehouse transfer orders (pipeline)",
    explainTemplate: "WarehouseTransferOrder not CLOSED.",
    routeHint: "/owner/inventory/warehouse-transfers",
  },
  {
    kpiKey: "INBOUND_OPEN_PURCHASE_ORDERS",
    domain: "INBOUND",
    grain: "ORG",
    label: "Open purchase orders",
    explainTemplate: "PurchaseOrder in DRAFT, SUBMITTED, APPROVED, or PARTIALLY_RECEIVED.",
    routeHint: "/owner/inventory/receipts",
  },
  {
    kpiKey: "INBOUND_GRN_LAST_7D",
    domain: "INBOUND",
    grain: "ORG",
    label: "GRN receipts (7d)",
    explainTemplate: "Grn records created in the last 7 days for this org.",
    routeHint: "/owner/inventory/receipts",
  },
  {
    kpiKey: "REVERSE_OPEN_VENDOR_RETURNS",
    domain: "REVERSE",
    grain: "ORG",
    label: "Vendor returns (open pipeline)",
    explainTemplate: "VendorReturn not CREDITED or CANCELLED.",
    routeHint: "/owner/inventory/reverse-logistics",
  },
  {
    kpiKey: "REVERSE_ACTIVE_RECALLS",
    domain: "REVERSE",
    grain: "ORG",
    label: "Active batch recalls",
    explainTemplate: "BatchRecall with status ACTIVE or QUARANTINED.",
    routeHint: "/owner/operations/command-center",
  },
  {
    kpiKey: "SLA_DISPATCH_DISCREPANCY_OPEN",
    domain: "SLA",
    grain: "ORG",
    label: "Open dispatch discrepancies",
    explainTemplate: "StockDispatchDiscrepancy with status PENDING.",
    routeHint: "/owner/operations/command-center",
  },
];

export function getKpiDefinition(kpiKey: string): KpiDefinition | undefined {
  return KPI_REGISTRY.find((k) => k.kpiKey === kpiKey);
}
