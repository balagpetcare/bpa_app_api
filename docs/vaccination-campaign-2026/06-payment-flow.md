# Payment Flow Design

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Overview

### 1.1 Payment Context
The 2026 campaign is primarily **FREE** for pet owners. However, the system must support paid campaigns for:
- Future campaigns with fees
- Premium/expedited slots
- Donation-based contributions
- Multi-vaccine packages

### 1.2 Integration Strategy
- **Reuse existing BPA payment infrastructure**
- Leverage existing `Order` and `OrderPayment` models
- Use existing payment gateway integrations

---

## 2. Existing Payment Infrastructure

### 2.1 Current BPA Models

```prisma
// Existing Order Model
model Order {
  id                Int          @id @default(autoincrement())
  orderNumber       String       @unique
  branchId          Int
  customerId        Int?
  status            OrderStatus  @default(PENDING)
  totalAmount       Decimal      @default(0)
  paymentMethod     PaymentMethod?
  paymentStatus     PaymentStatus @default(PENDING)
  // ...
  orderPayments     OrderPayment[]
  
  @@map("orders")
}

// Existing Payment Model
model OrderPayment {
  id            Int             @id @default(autoincrement())
  orderId       Int
  method        PaymentMethod
  amount        Decimal
  reference     String?
  paymentStatus OrderPaymentStatus @default(PAID)
  
  @@map("order_payments")
}

enum PaymentMethod {
  CASH
  BKASH
  NAGAD
  ROCKET
  CARD
  BANK_TRANSFER
}

enum PaymentStatus {
  PENDING
  COMPLETED
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
}
```

### 2.2 Existing Services

```
backend-api/src/api/v1/modules/
├── pos/pos.service.ts           # POS transactions
├── orders/orders.service.ts     # Order management
└── clinic/billing.service.ts    # Clinic billing
```

---

## 3. Campaign Payment Flow

### 3.1 Free Campaign Flow (Primary)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FREE CAMPAIGN FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

[User Selects Slot]
        │
        ▼
[Check Campaign Pricing]
        │
        │ pricingType === 'FREE'
        ▼
[Skip Payment Step]
        │
        ▼
[Create Booking]
        │
        ├── paymentStatus: NOT_REQUIRED
        ├── paymentOrderId: null
        └── paidAmount: null
        │
        ▼
[Booking Confirmed]
        │
        ▼
[Send Confirmation SMS]
```

### 3.2 Paid Campaign Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PAID CAMPAIGN FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

[User Selects Slot]
        │
        ▼
[Check Campaign Pricing]
        │
        │ pricingType === 'PAID'
        ▼
[Calculate Total]
        │
        ├── basePrice × petCount
        ├── + any location surcharge
        └── = totalAmount
        │
        ▼
[Show Payment Options]
        │
        ├── bKash
        ├── Nagad
        └── Card (Stripe/SSLCommerz)
        │
        ▼
[User Selects Payment Method]
        │
        ▼
[Create Pending Order]
        │
        ├── Order.status: PENDING
        ├── Order.paymentStatus: PENDING
        └── Order.totalAmount: calculated
        │
        ▼
[Initialize Payment Gateway]
        │
        ├── bKash: Create payment session
        ├── Nagad: Create payment session
        └── Card: Create checkout session
        │
        ▼
[Redirect to Gateway]
        │
        ▼
[User Completes Payment]
        │
        ▼
[Gateway Callback/Webhook]
        │
        ├─────────────────────────────────────────┐
        │                                         │
    [SUCCESS]                                 [FAILED]
        │                                         │
        ▼                                         ▼
[Verify Payment]                         [Update Order]
        │                                 status: FAILED
        ▼                                         │
[Update Order]                                    ▼
├── status: COMPLETED                    [Show Error]
├── paymentStatus: COMPLETED             [Offer Retry]
└── reference: gateway_txn_id
        │
        ▼
[Create Booking]
├── paymentStatus: COMPLETED
├── paymentOrderId: order.id
└── paidAmount: totalAmount
        │
        ▼
[Send Confirmation SMS]
```

### 3.3 Donation/Variable Amount Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DONATION CAMPAIGN FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

[User Selects Slot]
        │
        ▼
[Check Campaign Pricing]
        │
        │ pricingType === 'DONATION'
        ▼
[Show Suggested Amounts]
        │
        ├── ৳100 (Covers vaccines only)
        ├── ৳250 (Supports the campaign)
        ├── ৳500 (Premium supporter)
        └── Custom amount (min ৳50)
        │
        ▼
[User Enters/Selects Amount]
        │
        │ (amount === 0 allowed)
        ▼
[Proceed to Payment or Skip]
        │
        ├── If amount > 0: Payment Flow
        └── If amount === 0: Free Flow
```

---

## 4. Payment Gateway Integration

### 4.1 bKash Integration

```typescript
// Campaign Payment Service
interface BkashPaymentConfig {
  merchantId: string;
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
  baseUrl: string; // sandbox or production
}

interface CreateBkashPaymentRequest {
  bookingRef: string;
  amount: number;
  phone: string;
  callbackUrl: string;
}

async function initiateBkashPayment(req: CreateBkashPaymentRequest) {
  // 1. Get token from bKash
  const token = await getBkashToken();
  
  // 2. Create payment
  const payment = await bkashApi.createPayment({
    mode: '0011', // URL-based
    payerReference: req.bookingRef,
    callbackURL: req.callbackUrl,
    amount: req.amount,
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: req.bookingRef,
  });
  
  // 3. Return redirect URL
  return {
    paymentId: payment.paymentID,
    redirectUrl: payment.bkashURL,
  };
}

async function verifyBkashPayment(paymentId: string) {
  const token = await getBkashToken();
  const result = await bkashApi.executePayment({ paymentID: paymentId });
  
  return {
    success: result.statusCode === '0000',
    transactionId: result.trxID,
    amount: parseFloat(result.amount),
  };
}
```

### 4.2 Nagad Integration

```typescript
interface NagadPaymentConfig {
  merchantId: string;
  merchantNumber: string;
  publicKey: string;
  privateKey: string;
  baseUrl: string;
}

async function initiateNagadPayment(req: CreatePaymentRequest) {
  // 1. Initialize payment
  const initResponse = await nagadApi.initialize({
    merchantId: config.merchantId,
    orderId: req.bookingRef,
    dateTime: new Date().toISOString(),
  });
  
  // 2. Complete checkout
  const checkout = await nagadApi.checkout({
    sensitiveData: encryptedData,
    signature: generateSignature(data),
    merchantId: config.merchantId,
    orderId: req.bookingRef,
    currencyCode: '050', // BDT
    amount: req.amount.toString(),
    productUrl: req.callbackUrl,
  });
  
  return {
    paymentId: checkout.paymentReferenceId,
    redirectUrl: checkout.callBackUrl,
  };
}
```

### 4.3 Card Payment (SSLCommerz)

```typescript
interface SSLCommerzConfig {
  storeId: string;
  storePassword: string;
  isSandbox: boolean;
}

async function initiateCardPayment(req: CreatePaymentRequest) {
  const sslcommerz = new SSLCommerzPayment(config);
  
  const data = {
    total_amount: req.amount,
    currency: 'BDT',
    tran_id: req.bookingRef,
    success_url: `${baseUrl}/campaign-payment/callback/success`,
    fail_url: `${baseUrl}/campaign-payment/callback/fail`,
    cancel_url: `${baseUrl}/campaign-payment/callback/cancel`,
    cus_name: req.customerName,
    cus_phone: req.phone,
    cus_email: req.email || 'guest@bpa.com.bd',
    product_name: 'Vaccination Campaign Booking',
    product_category: 'Healthcare',
  };
  
  const response = await sslcommerz.init(data);
  
  return {
    sessionKey: response.sessionkey,
    redirectUrl: response.GatewayPageURL,
  };
}
```

---

## 5. Order Creation for Campaign

### 5.1 Campaign-Specific Order

```typescript
interface CreateCampaignOrderInput {
  campaignId: number;
  bookingRef: string;
  ownerPhone: string;
  ownerName: string;
  petCount: number;
  amount: number;
  paymentMethod: PaymentMethod;
}

async function createCampaignOrder(input: CreateCampaignOrderInput) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `CAMP-${input.bookingRef}`,
      branchId: CAMPAIGN_VIRTUAL_BRANCH_ID, // Special branch for campaigns
      status: 'PENDING',
      totalAmount: input.amount,
      paymentMethod: input.paymentMethod,
      paymentStatus: 'PENDING',
      orderSource: 'CAMPAIGN',
      notes: `Campaign booking: ${input.bookingRef}`,
      items: {
        create: {
          productId: CAMPAIGN_SERVICE_PRODUCT_ID, // Virtual product
          quantity: input.petCount,
          price: input.amount / input.petCount,
          total: input.amount,
        },
      },
    },
    include: {
      items: true,
    },
  });
  
  return order;
}
```

### 5.2 Payment Completion

```typescript
async function completeCampaignPayment(
  orderId: number,
  transactionId: string,
  paymentMethod: PaymentMethod
) {
  await prisma.$transaction(async (tx) => {
    // 1. Update order
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'COMPLETED',
        paymentStatus: 'COMPLETED',
      },
    });
    
    // 2. Create payment record
    await tx.orderPayment.create({
      data: {
        orderId,
        method: paymentMethod,
        amount: order.totalAmount,
        reference: transactionId,
        paymentStatus: 'PAID',
      },
    });
    
    // 3. Update booking
    await tx.campaignBooking.update({
      where: { paymentOrderId: orderId },
      data: {
        paymentStatus: 'COMPLETED',
        paidAmount: order.totalAmount,
      },
    });
  });
}
```

---

## 6. Refund Flow

### 6.1 Refund Policy

| Cancellation Time | Refund Amount |
|-------------------|---------------|
| 24+ hours before | 100% |
| 4-24 hours before | 50% |
| < 4 hours before | 0% |
| No-show | 0% |

### 6.2 Refund Processing

```typescript
interface RefundRequest {
  bookingId: number;
  reason: string;
  requestedBy: 'USER' | 'ADMIN';
}

async function processRefund(req: RefundRequest) {
  const booking = await prisma.campaignBooking.findUnique({
    where: { id: req.bookingId },
    include: { campaign: true },
  });
  
  if (!booking.paymentOrderId || booking.paymentStatus !== 'COMPLETED') {
    throw new Error('No payment to refund');
  }
  
  // Calculate refund amount based on policy
  const hoursUntilSlot = calculateHoursUntil(booking.slot);
  const refundPercent = getRefundPercent(hoursUntilSlot);
  const refundAmount = booking.paidAmount * (refundPercent / 100);
  
  if (refundAmount === 0) {
    return { refunded: false, reason: 'Outside refund policy' };
  }
  
  // Process refund with gateway
  const order = await prisma.order.findUnique({
    where: { id: booking.paymentOrderId },
    include: { orderPayments: true },
  });
  
  const payment = order.orderPayments[0];
  
  let refundResult;
  switch (payment.method) {
    case 'BKASH':
      refundResult = await refundBkash(payment.reference, refundAmount);
      break;
    case 'NAGAD':
      refundResult = await refundNagad(payment.reference, refundAmount);
      break;
    default:
      refundResult = await manualRefundQueue(payment, refundAmount);
  }
  
  // Update records
  await prisma.$transaction([
    prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: refundAmount === order.totalAmount 
          ? 'REFUNDED' 
          : 'PARTIALLY_REFUNDED',
      },
    }),
    prisma.campaignBooking.update({
      where: { id: booking.id },
      data: {
        refundStatus: 'COMPLETED',
        refundAmount,
      },
    }),
  ]);
  
  return { refunded: true, amount: refundAmount };
}
```

---

## 7. Payment Status Tracking

### 7.1 Status Flow

```
Payment Status Flow:
───────────────────

NOT_REQUIRED ──► (Free campaign, no payment needed)

PENDING ──► COMPLETED ──► (Optional) REFUNDED
   │                              │
   └──► FAILED                    └──► PARTIALLY_REFUNDED
```

### 7.2 Booking Payment States

| Booking Status | Payment Status | Description |
|----------------|----------------|-------------|
| CONFIRMED | NOT_REQUIRED | Free campaign |
| CONFIRMED | COMPLETED | Paid and confirmed |
| CANCELLED | COMPLETED | Paid, cancelled (refund pending) |
| CANCELLED | REFUNDED | Refund processed |
| NO_SHOW | COMPLETED | Paid, no refund |

---

## 8. Reporting

### 8.1 Payment Reports

```typescript
interface PaymentReportQuery {
  campaignId: number;
  from: Date;
  to: Date;
}

async function getCampaignPaymentReport(query: PaymentReportQuery) {
  const stats = await prisma.$queryRaw`
    SELECT 
      COUNT(*) as total_orders,
      SUM(CASE WHEN payment_status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN payment_status = 'FAILED' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN payment_status = 'REFUNDED' THEN 1 ELSE 0 END) as refunded,
      SUM(CASE WHEN payment_status = 'COMPLETED' THEN total_amount ELSE 0 END) as total_revenue,
      SUM(refund_amount) as total_refunds
    FROM campaign_bookings
    WHERE campaign_id = ${query.campaignId}
      AND created_at BETWEEN ${query.from} AND ${query.to}
  `;
  
  return {
    summary: stats[0],
    byMethod: await getPaymentsByMethod(query),
    byDate: await getDailyPayments(query),
  };
}
```

---

## 9. Security Considerations

### 9.1 Payment Security

- All payment callbacks verified with gateway signatures
- Payment amounts validated server-side
- No sensitive payment data stored (only references)
- PCI DSS compliance via gateway tokenization

### 9.2 Fraud Prevention

- Rate limiting on payment initiation
- Phone number verification before payment
- Duplicate transaction detection
- Admin alerts for unusual patterns

---

## 10. Testing

### 10.1 Test Cases

| Scenario | Expected Result |
|----------|-----------------|
| Free campaign booking | No payment, immediate confirmation |
| Paid booking - success | Payment completed, booking confirmed |
| Paid booking - failure | Payment failed, no booking created |
| Paid booking - abandon | Payment pending, slot released after timeout |
| Refund - within policy | Full/partial refund processed |
| Refund - outside policy | Refund denied |

### 10.2 Test Credentials

| Gateway | Sandbox Credentials |
|---------|---------------------|
| bKash | Use sandbox API keys |
| Nagad | Use sandbox merchant ID |
| SSLCommerz | Use test store |
