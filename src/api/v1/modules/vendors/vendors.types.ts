/**
 * Vendor module types (enterprise).
 */

export type VendorType =
  | "DISTRIBUTOR"
  | "WHOLESALER"
  | "IMPORTER"
  | "LOCAL"
  | "MANUFACTURER"
  | "OTHER";

export type VendorStatus = "ACTIVE" | "INACTIVE" | "BLACKLISTED";

export type VendorAttachmentType = "TRADE_LICENSE" | "INVOICE" | "CHALLAN" | "OTHER";

export type VendorLedgerSourceType = "PURCHASE_ORDER" | "GRN" | "PAYMENT" | "ADJUSTMENT" | "RETURN";

export interface CreateVendorInput {
  orgId: number;
  code?: string;
  name: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  district?: string;
  city?: string;
  country?: string;
  vendorType?: VendorType;
  defaultPaymentTermsDays?: number;
  creditLimit?: number;
  openingBalance?: number;
  notes?: string;
  contactJson?: Record<string, unknown>;
}

export interface UpdateVendorInput {
  code?: string;
  name?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  district?: string;
  city?: string;
  country?: string;
  vendorType?: VendorType;
  defaultPaymentTermsDays?: number;
  creditLimit?: number;
  openingBalance?: number;
  notes?: string;
  contactJson?: Record<string, unknown>;
}

export interface ListVendorsFilter {
  orgId: number;
  search?: string;
  status?: VendorStatus;
  page?: number;
  limit?: number;
}

export interface VendorLookupItem {
  id: number;
  code: string | null;
  name: string;
  phone: string | null;
}
