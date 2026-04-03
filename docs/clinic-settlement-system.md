# BPA Clinic Settlement System Architecture

> **Version:** 1.0  
> **Last Updated:** 2026-03-20  
> **Status:** Implementation Reference

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Concepts](#2-core-concepts)
3. [Schema Design](#3-schema-design)
4. [Status Lifecycle](#4-status-lifecycle)
5. [Batch Generation Logic](#5-batch-generation-logic)
6. [Doctor Earning Calculation](#6-doctor-earning-calculation)
7. [Discount Distribution Logic](#7-discount-distribution-logic)
8. [Surgery & Emergency Billing Integration](#8-surgery--emergency-billing-integration)
9. [Ledger Integration](#9-ledger-integration)
10. [API Endpoints](#10-api-endpoints)
11. [Domain Events](#11-domain-events)
12. [Implementation Files](#12-implementation-files)

---

## 1. Overview

The BPA Clinic Settlement System manages doctor earnings from clinical services, ensuring accurate calculation, transparent tracking, and timely payouts. It supports multiple contract types, handles complex billing scenarios (surgery, emergency, discounts), and provides a complete audit trail.

### Key Capabilities

- **Multi-contract support:** Revenue share, fixed fee, visiting specialist, salary+incentive, welfare/NGO
- **Flexible payout cycles:** Daily, weekly, bi-weekly, monthly
- **Surgery & emergency billing:** Specialized rate rules with staff role allocation
- **Discount impact handling:** Configurable burden distribution between clinic and doctor
- **Complete audit trail:** Every accrual, adjustment, approval, and payment is logged
- **Real-time ledger:** Doctors can view pending earnings and settlement history

---

## 2. Core Concepts

### 2.1 Settlement Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Visit/Order    │────▶│  Ledger Entry   │────▶│  Batch Created  │────▶│  Batch Paid     │
│  Completed      │     │  (PENDING)      │     │  (DRAFT)        │     │  (PAID)         │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │                       │
        ▼                       ▼                       ▼                       ▼
   Billing event          Doctor share            Period close           Doctor receives
   triggers accrual       calculated via          aggregates ledger      payout
                          contract engine         into batch
```

### 2.2 Key Entities

| Entity | Purpose |
|--------|---------|
| **DoctorSettlementLedger** | Individual earning records (per visit/order/surgery) |
| **DoctorSettlementBatch** | Aggregated payout batch for a period |
| **DoctorContract** | Earning rules and rates for a doctor |
| **DoctorContractRule** | Per-service or per-category rate overrides |
| **SettlementPayment** | Payment records against a batch |
| **SettlementAdjustment** | Clawbacks, bonuses, dispute resolutions |
| **SettlementAuditLog** | Complete audit trail |

---

## 3. Schema Design

### 3.1 DoctorSettlementLedger

Individual earning records created when billable events occur.

```prisma
model DoctorSettlementLedger {
  id                   Int       @id @default(autoincrement())
  orgId                Int
  branchId             Int
  clinicStaffProfileId Int       // Doctor's profile
  
  // Source linkage (one of these is set)
  visitId              Int?      // Regular consultation
  orderId              Int?      // Product/service order
  surgeryCaseId        Int?      // Surgery case
  caseId               Int?      // Clinical case reference
  packageId            Int?      // Surgery package reference
  
  // Entry classification
  type                 String    @db.VarChar(32)  // VISIT | ORDER | SURGERY | ADJUSTMENT
  staffRole            String?   @db.VarChar(32)  // PRIMARY_SURGEON | ASSISTANT | ANESTHETIST
  
  // Financial breakdown
  grossAmount          Decimal   @db.Decimal(12, 2)  // Total billed amount
  clinicShare          Decimal   @db.Decimal(12, 2)  // Clinic's portion
  doctorShare          Decimal   @db.Decimal(12, 2)  // Doctor's earning
  discountImpact       Decimal?  @db.Decimal(12, 2)  // Discount absorbed by doctor
  supportShare         Decimal?  @db.Decimal(12, 2)  // Support staff allocation
  directCost           Decimal?  @db.Decimal(12, 2)  // Consumables/materials
  netDoctorEarning     Decimal?  @db.Decimal(12, 2)  // Final after deductions
  
  // Settlement tracking
  settlementStatus     String    @default("PENDING") @db.VarChar(16)  // PENDING | BATCHED | PAID | DISPUTED
  batchId              Int?      // Link to settlement batch
  contractId           Int?      // Contract used for calculation
  settledAt            DateTime?
  settledByUserId      Int?
  periodStart          DateTime?
  periodEnd            DateTime?
  notes                String?   @db.Text
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([clinicStaffProfileId])
  @@index([branchId, settlementStatus])
  @@index([batchId])
  @@map("doctor_settlement_ledger")
}
```

### 3.2 DoctorSettlementBatch

Aggregated payout batch for a settlement period.

```prisma
model DoctorSettlementBatch {
  id                   Int       @id @default(autoincrement())
  orgId                Int
  branchId             Int
  clinicStaffProfileId Int       // Doctor receiving payout
  contractId           Int?      // Active contract at batch creation
  
  // Period definition
  periodStart          DateTime  @db.Date
  periodEnd            DateTime  @db.Date
  
  // Financial summary
  totalAccrued         Decimal   @db.Decimal(12, 2)  // Sum of doctorShare from ledger
  totalAdjustments     Decimal   @default(0) @db.Decimal(12, 2)  // Bonuses - clawbacks
  totalDeductions      Decimal   @default(0) @db.Decimal(12, 2)  // Tax, advances, etc.
  netPayable           Decimal   @db.Decimal(12, 2)  // Final payout amount
  
  // Status lifecycle
  status               String    @default("DRAFT") @db.VarChar(16)  // DRAFT | UNDER_REVIEW | APPROVED | PAID | DISPUTED
  
  // Approval tracking
  approvedByUserId     Int?
  approvedAt           DateTime?
  paidAt               DateTime?
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  // Relations
  ledgerEntries        DoctorSettlementLedger[]
  payments             SettlementPayment[]
  adjustments          SettlementAdjustment[]

  @@index([clinicStaffProfileId])
  @@index([branchId, periodStart, periodEnd])
  @@index([status])
  @@map("doctor_settlement_batches")
}
```

### 3.3 DoctorContract

Defines earning rules for a doctor at a branch.

```prisma
model DoctorContract {
  id                   Int       @id @default(autoincrement())
  orgId                Int
  branchId             Int
  clinicStaffProfileId Int
  
  // Contract type
  contractType         String    @db.VarChar(32)  // REVENUE_SHARE | FIXED_FEE | VISITING_SPECIALIST | SALARY_INCENTIVE | WELFARE_NGO
  
  // Validity period
  effectiveFrom        DateTime  @db.Date
  effectiveTo          DateTime? @db.Date
  status               String    @default("ACTIVE") @db.VarChar(16)  // ACTIVE | EXPIRED | TERMINATED
  
  // Rate rules (JSON)
  consultationRule     Json?     // { sharePct?: number, fixedFee?: number, floorFee?: number }
  surgeryRule          Json?     // { sharePct?: number, fixedFee?: number }
  emergencyRule        Json?     // { sharePct?: number, fixedFee?: number, multiplier?: number }
  discountImpactRule   Json?     // { doctorBearsPct?: number, maxImpact?: number }
  thresholdIncentiveJson Json?   // { tiers: [{ threshold: number, bonus: number }] }
  serviceApplicability Json?     // { serviceIds?: number[], categories?: string[] }
  
  // Payout configuration
  payoutFrequency      String    @default("MONTHLY") @db.VarChar(16)  // DAILY | WEEKLY | BIWEEKLY | MONTHLY
  
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  // Relations
  rules                DoctorContractRule[]

  @@index([clinicStaffProfileId])
  @@index([branchId, status])
  @@map("doctor_contracts")
}
```

### 3.4 DoctorContractRule

Per-service or per-category rate overrides.

```prisma
model DoctorContractRule {
  id               Int      @id @default(autoincrement())
  doctorContractId Int
  serviceId        Int?     // Specific service override
  category         String?  @db.VarChar(64)  // Category-level override (e.g., "SURGERY", "VACCINATION")
  
  rateType         String   @db.VarChar(32)  // SHARE_PCT | FIXED_FEE | PER_CASE | HYBRID
  rateValue        Decimal  @db.Decimal(12, 2)  // Percentage or fixed amount
  
  notes            String?  @db.Text
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([doctorContractId])
  @@map("doctor_contract_rules")
}
```

### 3.5 SettlementPayment

Payment records against a batch.

```prisma
model SettlementPayment {
  id                Int      @id @default(autoincrement())
  settlementBatchId Int
  paymentMethod     String   @db.VarChar(32)  // CASH | BANK_TRANSFER | MOBILE_WALLET | CHECK
  amount            Decimal  @db.Decimal(12, 2)
  paidByUserId      Int?
  receiptRef        String?  @db.VarChar(128)  // External reference (bank ref, check no.)
  paidAt            DateTime @default(now())
  createdAt         DateTime @default(now())

  @@index([settlementBatchId])
  @@map("settlement_payments")
}
```

### 3.6 SettlementAdjustment

Adjustments to a batch (clawbacks, bonuses, dispute resolutions).

```prisma
model SettlementAdjustment {
  id                Int      @id @default(autoincrement())
  settlementBatchId Int
  ledgerId          Int?     // Optional link to specific ledger entry
  
  adjustmentType    String   @db.VarChar(32)  // CLAWBACK | REFUND_REVERSAL | DISPUTE | BONUS | TAX_DEDUCTION | ADVANCE_RECOVERY
  amount            Decimal  @db.Decimal(12, 2)  // Positive = add to payout, negative = deduct
  reason            String?  @db.Text
  
  createdByUserId   Int?
  createdAt         DateTime @default(now())

  @@index([settlementBatchId])
  @@map("settlement_adjustments")
}
```

### 3.7 SettlementAuditLog

Complete audit trail for all settlement actions.

```prisma
model SettlementAuditLog {
  id                Int      @id @default(autoincrement())
  orgId             Int
  branchId          Int
  
  action            String   @db.VarChar(64)  // ACCRUED | BATCH_CREATED | REVIEWED | APPROVED | PAID | ADJUSTED | DISPUTED | REVERSED
  settlementBatchId Int?
  ledgerId          Int?
  
  byUserId          Int?
  meta              Json?    // Additional context (amounts, reasons, etc.)
  
  createdAt         DateTime @default(now())

  @@index([branchId, action])
  @@index([settlementBatchId])
  @@map("settlement_audit_logs")
}
```

---

## 4. Status Lifecycle

### 4.1 Ledger Entry Status

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ PENDING  │────▶│ BATCHED  │────▶│   PAID   │
└──────────┘     └──────────┘     └──────────┘
     │                                  ▲
     │           ┌──────────┐           │
     └──────────▶│ DISPUTED │───────────┘
                 └──────────┘
```

| Status | Description |
|--------|-------------|
| **PENDING** | Earning accrued, awaiting batch inclusion |
| **BATCHED** | Included in a settlement batch |
| **PAID** | Batch paid, earning settled |
| **DISPUTED** | Under dispute, excluded from current batch |

### 4.2 Batch Status

```
┌─────────┐     ┌──────────────┐     ┌──────────┐     ┌────────┐
│  DRAFT  │────▶│ UNDER_REVIEW │────▶│ APPROVED │────▶│  PAID  │
└─────────┘     └──────────────┘     └──────────┘     └────────┘
     │                │                    │
     │                │                    │
     ▼                ▼                    ▼
┌──────────┐    ┌──────────┐         ┌──────────────┐
│ REJECTED │    │ REJECTED │         │ PARTIALLY_PAID│
└──────────┘    └──────────┘         └──────────────┘
```

| Status | Description | Allowed Actions |
|--------|-------------|-----------------|
| **DRAFT** | Batch created, pending review | Edit, add adjustments, submit for review |
| **UNDER_REVIEW** | Being reviewed by finance/owner | Approve, reject, add adjustments |
| **APPROVED** | Ready for payout | Record payment |
| **PARTIALLY_PAID** | Partial payment recorded | Record additional payment |
| **PAID** | Fully paid | View only |
| **REJECTED** | Rejected, needs correction | Revert to draft |
| **DISPUTED** | Under dispute | Resolve dispute |

### 4.3 State Transitions

```typescript
const BATCH_TRANSITIONS = {
  DRAFT: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["PAID", "PARTIALLY_PAID"],
  PARTIALLY_PAID: ["PAID"],
  REJECTED: ["DRAFT"],
  DISPUTED: ["DRAFT", "APPROVED"],
  PAID: [], // Terminal state
};
```

---

## 5. Batch Generation Logic

### 5.1 Generation Trigger

Batches are generated based on the branch's settlement cycle configuration:

```typescript
// ClinicFinanceConfig.settlementCycle: DAILY | WEEKLY | BIWEEKLY | MONTHLY

async function generateBatchesForBranch(branchId: number, options?: { periodEnd?: Date }) {
  const cycle = await getSettlementCycleForBranch(branchId);
  const periodEnd = options?.periodEnd ?? new Date();
  const { start: periodStart, end: periodEndNorm } = getPeriodBounds(cycle, periodEnd);
  
  // Group pending ledger entries by doctor
  const ledgerGroups = await prisma.doctorSettlementLedger.groupBy({
    by: ["clinicStaffProfileId"],
    where: {
      branchId,
      settlementStatus: "PENDING",
      batchId: null,
      createdAt: { gte: periodStart, lte: periodEndNorm },
    },
    _sum: { doctorShare: true },
  });
  
  // Create batch for each doctor with earnings
  for (const group of ledgerGroups) {
    if (group._sum.doctorShare <= 0) continue;
    
    const batch = await prisma.doctorSettlementBatch.create({
      data: {
        branchId,
        clinicStaffProfileId: group.clinicStaffProfileId,
        periodStart,
        periodEnd: periodEndNorm,
        totalAccrued: group._sum.doctorShare,
        netPayable: group._sum.doctorShare,
        status: "DRAFT",
      },
    });
    
    // Link ledger entries to batch
    await prisma.doctorSettlementLedger.updateMany({
      where: {
        branchId,
        clinicStaffProfileId: group.clinicStaffProfileId,
        settlementStatus: "PENDING",
        batchId: null,
        createdAt: { gte: periodStart, lte: periodEndNorm },
      },
      data: { batchId: batch.id, settlementStatus: "BATCHED" },
    });
  }
}
```

### 5.2 Period Calculation

```typescript
function getPeriodBounds(cycle: SettlementCycle, periodEnd: Date): { start: Date; end: Date } {
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);

  switch (cycle) {
    case "DAILY":
      start.setHours(0, 0, 0, 0);
      break;
    case "WEEKLY":
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    case "BIWEEKLY":
      start.setDate(start.getDate() - 13);
      start.setHours(0, 0, 0, 0);
      break;
    case "MONTHLY":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
  }
  return { start, end };
}
```

### 5.3 Automated Generation (Cron Job)

```typescript
// Scheduled job: runs at end of each settlement cycle
async function runSettlementBatchGeneration() {
  const branches = await prisma.branch.findMany({
    where: { clinicEnabled: true, status: "ACTIVE" },
    select: { id: true },
  });
  
  for (const branch of branches) {
    const cycle = await getSettlementCycleForBranch(branch.id);
    if (shouldGenerateBatch(cycle)) {
      await generateBatchesForBranch(branch.id);
    }
  }
}
```

---

## 6. Doctor Earning Calculation

### 6.1 Contract Types

| Type | Description | Calculation |
|------|-------------|-------------|
| **REVENUE_SHARE** | Percentage of gross revenue | `doctorShare = grossAmount × sharePct / 100` |
| **FIXED_FEE** | Fixed amount per service | `doctorShare = min(fixedFee, grossAmount)` |
| **VISITING_SPECIALIST** | Higher rate for visiting doctors | `doctorShare = grossAmount × specialistRate / 100` |
| **SALARY_INCENTIVE** | Base salary + performance bonus | `doctorShare = baseSalary + incentiveBonus` |
| **WELFARE_NGO** | Reduced/waived fees for charity | `doctorShare = 0` or nominal |

### 6.2 Calculation Engine

```typescript
async function calculateDoctorShare(options: {
  clinicStaffProfileId: number;
  branchId: number;
  serviceId: number;
  serviceCategory?: string;
  grossAmount: number;
  isSurgery?: boolean;
  isEmergency?: boolean;
}): Promise<{
  doctorShare: number;
  clinicShare: number;
  rateType: string;
  rateValue: number;
  contractId: number;
}> {
  // 1. Get active contract
  const contract = await getContractForDoctor(
    options.clinicStaffProfileId,
    options.branchId
  );
  
  if (!contract) {
    // No contract: clinic keeps 100%
    return {
      doctorShare: 0,
      clinicShare: options.grossAmount,
      rateType: "NONE",
      rateValue: 0,
      contractId: 0,
    };
  }
  
  // 2. Apply emergency rule if applicable
  if (options.isEmergency && contract.emergencyRule) {
    return applyRule(contract.emergencyRule, options.grossAmount, contract.id);
  }
  
  // 3. Apply surgery rule if applicable
  if (options.isSurgery && contract.surgeryRule) {
    return applyRule(contract.surgeryRule, options.grossAmount, contract.id);
  }
  
  // 4. Check for service-specific rule
  const serviceRule = await prisma.doctorContractRule.findFirst({
    where: { doctorContractId: contract.id, serviceId: options.serviceId },
  });
  if (serviceRule) {
    return applyContractRule(serviceRule, options.grossAmount, contract.id);
  }
  
  // 5. Check for category-level rule
  if (options.serviceCategory) {
    const categoryRule = await prisma.doctorContractRule.findFirst({
      where: { doctorContractId: contract.id, category: options.serviceCategory },
    });
    if (categoryRule) {
      return applyContractRule(categoryRule, options.grossAmount, contract.id);
    }
  }
  
  // 6. Apply default consultation rule
  if (contract.consultationRule) {
    return applyRule(contract.consultationRule, options.grossAmount, contract.id);
  }
  
  // 7. No applicable rule
  return {
    doctorShare: 0,
    clinicShare: options.grossAmount,
    rateType: "NONE",
    rateValue: 0,
    contractId: contract.id,
  };
}
```

### 6.3 Rate Application

```typescript
function applyRule(
  rule: { sharePct?: number; fixedFee?: number; floorFee?: number },
  grossAmount: number,
  contractId: number
): CalculationResult {
  // Fixed fee model
  if (typeof rule.fixedFee === "number") {
    const doctorShare = Math.min(rule.fixedFee, grossAmount);
    return {
      doctorShare,
      clinicShare: round(grossAmount - doctorShare),
      rateType: "FIXED_FEE",
      rateValue: rule.fixedFee,
      contractId,
    };
  }
  
  // Percentage model
  if (typeof rule.sharePct === "number" && !rule.floorFee) {
    const doctorShare = round((grossAmount * rule.sharePct) / 100);
    return {
      doctorShare,
      clinicShare: round(grossAmount - doctorShare),
      rateType: "SHARE_PCT",
      rateValue: rule.sharePct,
      contractId,
    };
  }
  
  // Hybrid model: floor fee + percentage of excess
  if (typeof rule.floorFee === "number" && typeof rule.sharePct === "number") {
    const floorFee = Math.min(rule.floorFee, grossAmount);
    const excess = Math.max(0, grossAmount - floorFee);
    const upside = round((excess * rule.sharePct) / 100);
    const doctorShare = round(floorFee + upside);
    return {
      doctorShare,
      clinicShare: round(grossAmount - doctorShare),
      rateType: "HYBRID",
      rateValue: doctorShare,
      contractId,
    };
  }
  
  return { doctorShare: 0, clinicShare: grossAmount, rateType: "NONE", rateValue: 0, contractId };
}
```

### 6.4 Threshold Incentives

```typescript
// Contract.thresholdIncentiveJson example:
// { tiers: [{ threshold: 50000, bonus: 5000 }, { threshold: 100000, bonus: 15000 }] }

async function calculateThresholdBonus(
  clinicStaffProfileId: number,
  branchId: number,
  periodStart: Date,
  periodEnd: Date
): Promise<number> {
  const contract = await getContractForDoctor(clinicStaffProfileId, branchId);
  if (!contract?.thresholdIncentiveJson) return 0;
  
  const tiers = contract.thresholdIncentiveJson.tiers || [];
  if (tiers.length === 0) return 0;
  
  // Calculate total earnings for period
  const totalEarnings = await prisma.doctorSettlementLedger.aggregate({
    where: {
      clinicStaffProfileId,
      branchId,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    _sum: { grossAmount: true },
  });
  
  const gross = Number(totalEarnings._sum.grossAmount ?? 0);
  
  // Find applicable tier (highest threshold met)
  let bonus = 0;
  for (const tier of tiers.sort((a, b) => b.threshold - a.threshold)) {
    if (gross >= tier.threshold) {
      bonus = tier.bonus;
      break;
    }
  }
  
  return bonus;
}
```

---

## 7. Discount Distribution Logic

### 7.1 Discount Impact Rule

When discounts are applied to patient bills, the financial impact can be distributed between clinic and doctor:

```typescript
// Contract.discountImpactRule example:
// { doctorBearsPct: 50, maxImpact: 500 }  // Doctor bears 50% of discount, max ৳500

interface DiscountImpactRule {
  doctorBearsPct: number;   // 0-100: percentage of discount doctor absorbs
  maxImpact?: number;       // Maximum amount doctor can absorb
  exemptCategories?: string[]; // Categories exempt from discount impact
}
```

### 7.2 Discount Impact Calculation

```typescript
function calculateDiscountImpact(
  grossAmount: number,
  discountAmount: number,
  discountImpactRule: DiscountImpactRule | null,
  serviceCategory?: string
): { doctorImpact: number; clinicImpact: number } {
  if (!discountImpactRule || discountAmount <= 0) {
    return { doctorImpact: 0, clinicImpact: discountAmount };
  }
  
  // Check if category is exempt
  if (
    serviceCategory &&
    discountImpactRule.exemptCategories?.includes(serviceCategory)
  ) {
    return { doctorImpact: 0, clinicImpact: discountAmount };
  }
  
  // Calculate doctor's share of discount
  let doctorImpact = round((discountAmount * discountImpactRule.doctorBearsPct) / 100);
  
  // Apply maximum cap
  if (discountImpactRule.maxImpact != null) {
    doctorImpact = Math.min(doctorImpact, discountImpactRule.maxImpact);
  }
  
  // Ensure doctor impact doesn't exceed their share
  const maxDoctorImpact = grossAmount - discountAmount;
  doctorImpact = Math.min(doctorImpact, maxDoctorImpact);
  
  return {
    doctorImpact,
    clinicImpact: discountAmount - doctorImpact,
  };
}
```

### 7.3 Net Earning Calculation with Discount

```typescript
async function calculateNetDoctorEarning(options: {
  grossAmount: number;
  discountAmount: number;
  clinicStaffProfileId: number;
  branchId: number;
  serviceId: number;
  serviceCategory?: string;
}): Promise<{
  grossAmount: number;
  discountAmount: number;
  discountImpact: number;
  doctorShare: number;
  netDoctorEarning: number;
}> {
  const contract = await getContractForDoctor(
    options.clinicStaffProfileId,
    options.branchId
  );
  
  // Calculate base doctor share on gross
  const baseCalc = await calculateDoctorShare({
    clinicStaffProfileId: options.clinicStaffProfileId,
    branchId: options.branchId,
    serviceId: options.serviceId,
    serviceCategory: options.serviceCategory,
    grossAmount: options.grossAmount,
  });
  
  // Calculate discount impact
  const discountImpact = calculateDiscountImpact(
    options.grossAmount,
    options.discountAmount,
    contract?.discountImpactRule as DiscountImpactRule | null,
    options.serviceCategory
  );
  
  // Net earning = base share - discount impact
  const netDoctorEarning = Math.max(0, baseCalc.doctorShare - discountImpact.doctorImpact);
  
  return {
    grossAmount: options.grossAmount,
    discountAmount: options.discountAmount,
    discountImpact: discountImpact.doctorImpact,
    doctorShare: baseCalc.doctorShare,
    netDoctorEarning,
  };
}
```

---

## 8. Surgery & Emergency Billing Integration

### 8.1 Surgery Case Settlement

Surgery cases involve multiple staff roles with different earning allocations:

```typescript
async function createSettlementLedgerForSurgeryCase(surgeryCaseId: number): Promise<void> {
  const surgeryCase = await prisma.surgeryCase.findUnique({
    where: { id: surgeryCaseId },
    include: {
      primaryDoctor: { include: { clinicStaffProfile: true } },
      staff: { include: { branchMember: { include: { clinicStaffProfile: true } } } },
      clinicInvoices: { take: 1, orderBy: { id: "desc" } },
    },
  });
  
  const invoice = surgeryCase.clinicInvoices?.[0];
  const grossTotal = Number(invoice?.doctorFeeAmount ?? 0);
  
  // 1. Primary surgeon settlement
  if (surgeryCase.primaryDoctor?.clinicStaffProfile && grossTotal > 0) {
    const calc = await calculateDoctorShare({
      clinicStaffProfileId: surgeryCase.primaryDoctor.clinicStaffProfile.id,
      branchId: surgeryCase.branchId,
      serviceId: surgeryCase.serviceId,
      grossAmount: grossTotal,
      isSurgery: true,
    });
    
    await prisma.doctorSettlementLedger.create({
      data: {
        orgId: surgeryCase.orgId,
        branchId: surgeryCase.branchId,
        clinicStaffProfileId: surgeryCase.primaryDoctor.clinicStaffProfile.id,
        surgeryCaseId,
        staffRole: "PRIMARY_SURGEON",
        type: "SURGERY",
        grossAmount: grossTotal,
        doctorShare: calc.doctorShare,
        clinicShare: calc.clinicShare,
        settlementStatus: "PENDING",
        contractId: calc.contractId || null,
      },
    });
  }
  
  // 2. Support staff settlements (assistants, anesthetists, etc.)
  for (const staff of surgeryCase.staff || []) {
    const profile = staff.branchMember?.clinicStaffProfile;
    if (!profile) continue;
    
    const feeValue = Number(staff.feeValue ?? 0);
    if (feeValue <= 0) continue;
    
    await prisma.doctorSettlementLedger.create({
      data: {
        orgId: surgeryCase.orgId,
        branchId: surgeryCase.branchId,
        clinicStaffProfileId: profile.id,
        surgeryCaseId,
        staffRole: staff.role,  // ASSISTANT | ANESTHETIST | NURSE
        type: "SURGERY",
        grossAmount: feeValue,
        doctorShare: feeValue,  // Support staff get full allocated amount
        clinicShare: 0,
        settlementStatus: "PENDING",
      },
    });
  }
}
```

### 8.2 Surgery Staff Roles

| Role | Description | Typical Allocation |
|------|-------------|-------------------|
| **PRIMARY_SURGEON** | Lead surgeon | Contract-based (e.g., 70% of surgeon fee) |
| **ASSISTANT** | Surgical assistant | Fixed fee or percentage |
| **ANESTHETIST** | Anesthesia provider | Fixed fee per case |
| **NURSE** | Surgical nurse | Fixed fee or hourly |
| **TECHNICIAN** | Equipment/lab tech | Fixed fee |

### 8.3 Emergency Billing

Emergency cases use the `emergencyRule` from the doctor's contract:

```typescript
// Contract.emergencyRule example:
// { sharePct: 80, multiplier: 1.5 }  // 80% share with 1.5x multiplier

async function calculateEmergencyEarning(options: {
  clinicStaffProfileId: number;
  branchId: number;
  serviceId: number;
  grossAmount: number;
}): Promise<CalculationResult> {
  const contract = await getContractForDoctor(
    options.clinicStaffProfileId,
    options.branchId
  );
  
  if (!contract?.emergencyRule) {
    // Fall back to regular calculation
    return calculateDoctorShare({ ...options, isEmergency: false });
  }
  
  const rule = contract.emergencyRule as {
    sharePct?: number;
    fixedFee?: number;
    multiplier?: number;
  };
  
  // Apply multiplier to gross if specified
  const effectiveGross = rule.multiplier
    ? options.grossAmount * rule.multiplier
    : options.grossAmount;
  
  return applyRule(rule, effectiveGross, contract.id);
}
```

### 8.4 Emergency Fee Resolution

```typescript
// consultationFee.service.ts
async function resolveConsultationFee(options: {
  branchId: number;
  doctorId: number;
  serviceId: number;
  isEmergency?: boolean;
}): Promise<{ feeAmount: number; source: string }> {
  if (options.isEmergency && options.doctorId) {
    const staffProfile = await prisma.clinicStaffProfile.findUnique({
      where: { id: options.doctorId },
      select: { emergencyFee: true },
    });
    
    if (staffProfile?.emergencyFee > 0) {
      return {
        feeAmount: Number(staffProfile.emergencyFee),
        source: "EMERGENCY_FEE",
      };
    }
  }
  
  // Fall back to regular fee resolution
  return resolveRegularFee(options);
}
```

---

## 9. Ledger Integration

### 9.1 DoctorSettlementLedger Entry Points

Ledger entries are created at these billing events:

| Event | Trigger | Service |
|-------|---------|---------|
| Visit completed | `completeVisit()` | `doctorSettlement.createSettlementLedgerForVisit()` |
| Order paid | `processPayment()` | `doctorSettlement.createSettlementLedgerForOrder()` |
| Surgery invoiced | `finalizeSurgeryInvoice()` | `doctorSettlement.createSettlementLedgerForSurgeryCase()` |

### 9.2 Visit Settlement

```typescript
async function createSettlementLedgerForVisit(visitId: number): Promise<void> {
  // Idempotency check
  const existing = await prisma.doctorSettlementLedger.findFirst({
    where: { visitId },
  });
  if (existing) return;
  
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: {
      doctor: { include: { clinicStaffProfile: true } },
      appointment: { include: { service: true } },
    },
  });
  
  if (!visit?.doctor?.clinicStaffProfile) return;
  if (visit.doctor.clinicStaffProfile.staffType !== "DOCTOR") return;
  
  // Resolve consultation fee
  const grossAmount = Number(
    visit.doctor.clinicStaffProfile.followUpFee ??
    visit.doctor.clinicStaffProfile.defaultConsultationFee ??
    0
  );
  if (grossAmount <= 0) return;
  
  // Calculate shares using contract engine
  const calc = await calculateDoctorShare({
    clinicStaffProfileId: visit.doctor.clinicStaffProfile.id,
    branchId: visit.branchId,
    serviceId: visit.appointment?.serviceId ?? 0,
    grossAmount,
    isSurgery: false,
    isEmergency: visit.appointment?.isEmergency ?? false,
  });
  
  // Create ledger entry
  await prisma.doctorSettlementLedger.create({
    data: {
      orgId: visit.orgId,
      branchId: visit.branchId,
      clinicStaffProfileId: visit.doctor.clinicStaffProfile.id,
      visitId: visit.id,
      type: "VISIT",
      grossAmount,
      doctorShare: calc.doctorShare,
      clinicShare: calc.clinicShare,
      settlementStatus: "PENDING",
      contractId: calc.contractId || null,
    },
  });
  
  // Emit domain event
  emit(DOMAIN_EVENTS.SETTLEMENT_ACCRUED, {
    visitId,
    branchId: visit.branchId,
    clinicStaffProfileId: visit.doctor.clinicStaffProfile.id,
    grossAmount,
    doctorShare: calc.doctorShare,
  });
}
```

### 9.3 Order Settlement

```typescript
async function createSettlementLedgerForOrder(orderId: number): Promise<void> {
  // Idempotency check
  const existing = await prisma.doctorSettlementLedger.findFirst({
    where: { orderId },
  });
  if (existing) return;
  
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      visit: {
        include: {
          doctor: { include: { clinicStaffProfile: true } },
        },
      },
    },
  });
  
  if (!order?.visitId || !order.visit?.doctor?.clinicStaffProfile) return;
  
  const grossAmount = Number(order.totalAmount ?? 0);
  if (grossAmount <= 0) return;
  
  const calc = await calculateDoctorShare({
    clinicStaffProfileId: order.visit.doctor.clinicStaffProfile.id,
    branchId: order.branchId,
    serviceId: 0,
    grossAmount,
  });
  
  await prisma.doctorSettlementLedger.create({
    data: {
      orgId: order.visit.orgId,
      branchId: order.branchId,
      clinicStaffProfileId: order.visit.doctor.clinicStaffProfile.id,
      visitId: order.visitId,
      orderId: order.id,
      type: "ORDER",
      grossAmount,
      doctorShare: calc.doctorShare,
      clinicShare: calc.clinicShare,
      settlementStatus: "PENDING",
      contractId: calc.contractId || null,
    },
  });
}
```

### 9.4 Doctor Ledger View

```typescript
async function getMySettlementLedger(
  userId: number,
  branchId: number,
  opts?: { status?: string; from?: string; to?: string }
) {
  const member = await prisma.branchMember.findFirst({
    where: { branchId, userId },
    include: { clinicStaffProfile: true },
  });
  
  if (!member?.clinicStaffProfile || member.clinicStaffProfile.staffType !== "DOCTOR") {
    return null;
  }
  
  const where: any = {
    branchId,
    clinicStaffProfileId: member.clinicStaffProfile.id,
  };
  
  if (opts?.status) where.settlementStatus = opts.status;
  if (opts?.from || opts?.to) {
    where.createdAt = {};
    if (opts.from) where.createdAt.gte = new Date(opts.from);
    if (opts.to) where.createdAt.lte = new Date(opts.to);
  }
  
  return prisma.doctorSettlementLedger.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
```

---

## 10. API Endpoints

### 10.1 Staff/Owner Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/clinic/branches/:branchId/settlements/generate` | Generate batches for period |
| GET | `/clinic/branches/:branchId/settlements/batches` | List settlement batches |
| GET | `/clinic/branches/:branchId/settlements/batches/:batchId` | Get batch details |
| POST | `/clinic/branches/:branchId/settlements/batches/:batchId/review` | Submit for review |
| POST | `/clinic/branches/:branchId/settlements/batches/:batchId/approve` | Approve batch |
| POST | `/clinic/branches/:branchId/settlements/batches/:batchId/pay` | Record payment |
| POST | `/clinic/branches/:branchId/settlements/batches/:batchId/adjustments` | Add adjustment |
| GET | `/clinic/branches/:branchId/settlements/ledger` | View all ledger entries |

### 10.2 Doctor Panel Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/doctor/branches/:branchId/settlements/summary` | Pending earnings + recent batches |
| GET | `/doctor/branches/:branchId/settlements/ledger` | My ledger entries |
| GET | `/doctor/branches/:branchId/settlements/batches` | My settlement batches |
| GET | `/doctor/branches/:branchId/settlements/batches/:batchId` | Batch detail |

### 10.3 Contract Management Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/clinic/branches/:branchId/contracts` | List doctor contracts |
| POST | `/clinic/branches/:branchId/contracts` | Create contract |
| GET | `/clinic/branches/:branchId/contracts/:contractId` | Get contract |
| PATCH | `/clinic/branches/:branchId/contracts/:contractId` | Update contract |
| POST | `/clinic/branches/:branchId/contracts/:contractId/rules` | Add/update rule |
| DELETE | `/clinic/branches/:branchId/contracts/:contractId/rules/:ruleId` | Delete rule |
| GET | `/clinic/branches/:branchId/contracts/preview` | Rate preview |

---

## 11. Domain Events

### 11.1 Settlement Events

| Event | Payload | Triggered When |
|-------|---------|----------------|
| `SETTLEMENT_ACCRUED` | `{ ledgerId, branchId, clinicStaffProfileId, visitId?, orderId?, grossAmount, doctorShare }` | Ledger entry created |
| `SETTLEMENT_BATCH_CREATED` | `{ batchId, branchId, clinicStaffProfileId, periodStart, periodEnd, totalAccrued }` | Batch generated |
| `SETTLEMENT_APPROVED` | `{ batchId, branchId, clinicStaffProfileId, netPayable, approvedByUserId }` | Batch approved |
| `SETTLEMENT_PAID` | `{ batchId, branchId, clinicStaffProfileId, amount, paidByUserId, receiptRef }` | Payment recorded |
| `SETTLEMENT_DISPUTED` | `{ batchId, ledgerId?, branchId, reason, disputedByUserId }` | Dispute raised |

### 11.2 Event Handlers

```typescript
// Notification on settlement accrual
on(DOMAIN_EVENTS.SETTLEMENT_ACCRUED, async (payload) => {
  await notifyDoctor(payload.clinicStaffProfileId, {
    type: "EARNING_ACCRUED",
    amount: payload.doctorShare,
    visitId: payload.visitId,
  });
});

// Notification on batch approval
on(DOMAIN_EVENTS.SETTLEMENT_APPROVED, async (payload) => {
  await notifyDoctor(payload.clinicStaffProfileId, {
    type: "SETTLEMENT_READY",
    batchId: payload.batchId,
    amount: payload.netPayable,
  });
});

// Notification on payment
on(DOMAIN_EVENTS.SETTLEMENT_PAID, async (payload) => {
  await notifyDoctor(payload.clinicStaffProfileId, {
    type: "SETTLEMENT_PAID",
    batchId: payload.batchId,
    amount: payload.amount,
    receiptRef: payload.receiptRef,
  });
});
```

---

## 12. Implementation Files

### 12.1 Backend Services

| File | Purpose |
|------|---------|
| `src/api/v1/modules/clinic/doctorSettlement.service.ts` | Ledger entry creation |
| `src/api/v1/modules/clinic/settlementBatch.service.ts` | Batch generation, approval, payment |
| `src/api/v1/modules/clinic/doctorContract.service.ts` | Contract CRUD, rate calculation |
| `src/api/v1/modules/clinic/consultationFee.service.ts` | Fee resolution |
| `src/api/v1/modules/clinic/billing.service.ts` | Invoice creation, payment processing |

### 12.2 Controllers

| File | Purpose |
|------|---------|
| `src/api/v1/modules/clinic/clinic.controller.ts` | Staff settlement endpoints |
| `src/api/v1/modules/doctor/doctor.controller.ts` | Doctor panel settlement endpoints |

### 12.3 Prisma Schema

| Model | Table |
|-------|-------|
| `DoctorSettlementLedger` | `doctor_settlement_ledger` |
| `DoctorSettlementBatch` | `doctor_settlement_batches` |
| `DoctorContract` | `doctor_contracts` |
| `DoctorContractRule` | `doctor_contract_rules` |
| `SettlementPayment` | `settlement_payments` |
| `SettlementAdjustment` | `settlement_adjustments` |
| `SettlementAuditLog` | `settlement_audit_logs` |

---

## Appendix A: Example Contract Configurations

### A.1 Revenue Share (Standard)

```json
{
  "contractType": "REVENUE_SHARE",
  "consultationRule": { "sharePct": 60 },
  "surgeryRule": { "sharePct": 70 },
  "emergencyRule": { "sharePct": 65 },
  "discountImpactRule": { "doctorBearsPct": 50, "maxImpact": 500 },
  "payoutFrequency": "MONTHLY"
}
```

### A.2 Fixed Fee (Per Visit)

```json
{
  "contractType": "FIXED_FEE",
  "consultationRule": { "fixedFee": 300 },
  "surgeryRule": { "fixedFee": 5000 },
  "emergencyRule": { "fixedFee": 500 },
  "payoutFrequency": "WEEKLY"
}
```

### A.3 Hybrid (Floor + Percentage)

```json
{
  "contractType": "REVENUE_SHARE",
  "consultationRule": { "floorFee": 200, "sharePct": 40 },
  "surgeryRule": { "floorFee": 3000, "sharePct": 50 },
  "payoutFrequency": "BIWEEKLY"
}
```

### A.4 Visiting Specialist

```json
{
  "contractType": "VISITING_SPECIALIST",
  "consultationRule": { "sharePct": 80 },
  "surgeryRule": { "sharePct": 85 },
  "emergencyRule": { "sharePct": 80, "multiplier": 1.5 },
  "discountImpactRule": { "doctorBearsPct": 0 },
  "payoutFrequency": "DAILY"
}
```

### A.5 Salary + Incentive

```json
{
  "contractType": "SALARY_INCENTIVE",
  "consultationRule": { "sharePct": 0 },
  "thresholdIncentiveJson": {
    "tiers": [
      { "threshold": 50000, "bonus": 5000 },
      { "threshold": 100000, "bonus": 15000 },
      { "threshold": 200000, "bonus": 35000 }
    ]
  },
  "payoutFrequency": "MONTHLY"
}
```

---

## Appendix B: Settlement Cycle Configuration

### B.1 ClinicFinanceConfig

```prisma
model ClinicFinanceConfig {
  id                Int      @id @default(autoincrement())
  branchId          Int      @unique
  settlementCycle   String   @default("MONTHLY") @db.VarChar(16)
  autoGenerateBatch Boolean  @default(true)
  requireApproval   Boolean  @default(true)
  minPayoutAmount   Decimal? @db.Decimal(12, 2)
  taxDeductionPct   Decimal? @db.Decimal(5, 2)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@map("clinic_finance_configs")
}
```

### B.2 Cycle Schedule

| Cycle | Generation Trigger | Period |
|-------|-------------------|--------|
| DAILY | End of day (23:59) | Same day |
| WEEKLY | Sunday 23:59 | Mon-Sun |
| BIWEEKLY | Every other Sunday | 14 days |
| MONTHLY | Last day of month | 1st to last |

---

*End of Document*
