# QA Strategy Document

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. QA Overview

### 1.1 Testing Objectives

- Ensure system functionality meets requirements
- Validate user experience across devices
- Verify integration with existing BPA systems
- Confirm security requirements are met
- Validate performance under expected load

### 1.2 Testing Scope

| In Scope | Out of Scope |
|----------|--------------|
| Campaign booking flow | Existing BPA app features |
| Staff portal | Existing admin panel |
| Payment integration | Payment gateway internals |
| SMS notifications | SMS provider infrastructure |
| Certificate generation | Printer hardware |
| API endpoints | Third-party API behavior |
| Database operations | Database engine |

### 1.3 Testing Levels

```
┌─────────────────────────────────────────────────────────────────┐
│                      TESTING PYRAMID                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                        ╱╲                                       │
│                       ╱  ╲     E2E Tests                       │
│                      ╱ 10%╲    (Critical paths)                │
│                     ╱──────╲                                    │
│                    ╱        ╲                                   │
│                   ╱   20%    ╲  Integration Tests              │
│                  ╱────────────╲ (APIs, Database)               │
│                 ╱              ╲                                │
│                ╱      70%       ╲ Unit Tests                   │
│               ╱──────────────────╲(Services, Utils)            │
│              ╱                    ╲                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Test Strategy

### 2.1 Unit Testing

**Framework:** Jest + TypeScript

**Coverage Target:** 80% minimum

**Focus Areas:**
- Service layer logic
- Validation schemas
- Utility functions
- Token generation/verification

```typescript
// Example: Certificate token generation test
describe('CertificateService', () => {
  describe('generateCertificateToken', () => {
    it('should generate valid format token', () => {
      const token = generateCertificateToken();
      expect(token).toMatch(/^CERT-[A-Z0-9]{12}$/);
    });
    
    it('should generate unique tokens', () => {
      const tokens = Array.from({ length: 1000 }, () => generateCertificateToken());
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(1000);
    });
  });
  
  describe('verifyCertificateToken', () => {
    it('should return valid for existing certificate', async () => {
      const cert = await createTestCertificate();
      const result = await verifyCertificateToken(cert.token);
      expect(result.valid).toBe(true);
      expect(result.petName).toBe(cert.petName);
    });
    
    it('should return invalid for non-existent token', async () => {
      const result = await verifyCertificateToken('CERT-NONEXISTENT');
      expect(result.valid).toBe(false);
    });
  });
});
```

### 2.2 Integration Testing

**Framework:** Jest + Supertest

**Database:** Test database (isolated)

**Focus Areas:**
- API endpoint behavior
- Database operations
- Service interactions
- Authentication/authorization

```typescript
// Example: Booking API integration test
describe('POST /api/v1/campaign-booking', () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await seedTestCampaign();
  });
  
  it('should create booking with valid data', async () => {
    // Setup: Get valid session
    const session = await createTestSession('01712345678');
    
    const response = await request(app)
      .post('/api/v1/campaign-booking')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        campaignId: 1,
        locationId: 1,
        slotId: 1,
        owner: { name: 'Test Owner' },
        pets: [{ name: 'Mittens', gender: 'FEMALE' }],
      });
    
    expect(response.status).toBe(201);
    expect(response.body.bookingRef).toMatch(/^VAC-[A-Z0-9]{6}$/);
    expect(response.body.pets).toHaveLength(1);
    expect(response.body.qrToken).toBeDefined();
    
    // Verify database state
    const booking = await prisma.campaignBooking.findFirst({
      where: { bookingRef: response.body.bookingRef },
    });
    expect(booking).not.toBeNull();
  });
  
  it('should reject booking for full slot', async () => {
    await fillSlotToCapacity(1);
    const session = await createTestSession('01712345679');
    
    const response = await request(app)
      .post('/api/v1/campaign-booking')
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        campaignId: 1,
        locationId: 1,
        slotId: 1,
        owner: { name: 'Test Owner' },
        pets: [{ name: 'Whiskers' }],
      });
    
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('SLOT_FULL');
  });
  
  it('should enforce rate limiting', async () => {
    const session = await createTestSession('01712345680');
    
    // Make 10 rapid requests
    const requests = Array.from({ length: 12 }, () =>
      request(app)
        .post('/api/v1/campaign-booking')
        .set('Authorization', `Bearer ${session.token}`)
        .send({ /* valid data */ })
    );
    
    const responses = await Promise.all(requests);
    const rateLimited = responses.filter((r) => r.status === 429);
    
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});
```

### 2.3 End-to-End Testing

**Framework:** Playwright

**Browsers:** Chrome, Firefox, Safari, Mobile Chrome

**Focus Areas:**
- Complete user journeys
- Cross-browser compatibility
- Mobile responsiveness
- Critical business flows

```typescript
// Example: Complete booking flow E2E test
import { test, expect } from '@playwright/test';

test.describe('Campaign Booking Flow', () => {
  test('should complete booking from start to finish', async ({ page }) => {
    // Step 1: Land on campaign page
    await page.goto('https://vacc.bpa.com.bd');
    await expect(page.locator('h1')).toContainText('Cat Vaccination');
    
    // Step 2: Click book now
    await page.click('text=Book Now');
    await expect(page).toHaveURL(/\/book/);
    
    // Step 3: Enter phone number
    await page.fill('[name=phone]', '01712345678');
    await page.click('text=Send OTP');
    
    // Step 4: Enter OTP (use test OTP in staging)
    await page.fill('[name=otp]', '123456');
    await page.click('text=Verify');
    
    // Step 5: Select location
    await page.click('text=Dhaka Central Vet Clinic');
    
    // Step 6: Select date/slot
    await page.click('.available-slot >> nth=0');
    
    // Step 7: Enter owner details
    await page.fill('[name=ownerName]', 'Test User');
    
    // Step 8: Add pet
    await page.fill('[name=pets.0.name]', 'Mittens');
    await page.selectOption('[name=pets.0.gender]', 'FEMALE');
    
    // Step 9: Confirm booking
    await page.click('text=Confirm Booking');
    
    // Step 10: Verify success
    await expect(page.locator('.booking-success')).toBeVisible();
    await expect(page.locator('.booking-ref')).toContainText(/VAC-/);
    await expect(page.locator('.qr-code')).toBeVisible();
  });
  
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('https://vacc.bpa.com.bd');
    
    // Mobile-specific checks
    await expect(page.locator('.mobile-menu-button')).toBeVisible();
    await expect(page.locator('.booking-form')).toBeVisible();
  });
});
```

---

## 3. Test Categories

### 3.1 Functional Testing

| Feature | Test Cases | Priority |
|---------|------------|----------|
| OTP Authentication | 12 | High |
| Booking Creation | 20 | High |
| Slot Management | 15 | High |
| Check-in Process | 18 | High |
| Vaccination Recording | 15 | High |
| Certificate Generation | 10 | High |
| Payment Processing | 15 | High |
| SMS Notifications | 12 | Medium |
| Walk-in Registration | 10 | Medium |
| Queue Management | 12 | Medium |
| Reporting | 8 | Medium |

### 3.2 Security Testing

```yaml
security_tests:
  authentication:
    - OTP brute force protection
    - Session token expiration
    - Token tampering detection
    - Concurrent session handling
    
  authorization:
    - Role-based access enforcement
    - Resource ownership verification
    - Staff location restrictions
    - Admin-only operations
    
  input_validation:
    - SQL injection prevention
    - XSS prevention
    - Path traversal prevention
    - File upload restrictions (if applicable)
    
  data_protection:
    - Phone number masking in logs
    - Sensitive data encryption
    - Secure certificate storage
    
  api_security:
    - Rate limiting effectiveness
    - CORS configuration
    - Security headers presence
```

### 3.3 Performance Testing

**Tool:** k6

**Scenarios:**
1. Normal load (expected traffic)
2. Peak load (2x expected)
3. Stress test (find breaking point)
4. Soak test (extended duration)

```javascript
// k6 load test script
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    normal_load: {
      executor: 'constant-arrival-rate',
      rate: 50, // 50 requests per second
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 100,
    },
    peak_load: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 400,
      startTime: '10m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% under 500ms
    http_req_failed: ['rate<0.01'],   // <1% failure rate
  },
};

export default function () {
  // Simulate booking lookup
  const res = http.get('https://api.bpa.com.bd/api/v1/campaigns/1');
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time OK': (r) => r.timings.duration < 500,
  });
  
  sleep(1);
}
```

**Performance Targets:**

| Metric | Target | Acceptable |
|--------|--------|------------|
| Response time (p50) | < 200ms | < 300ms |
| Response time (p95) | < 500ms | < 800ms |
| Response time (p99) | < 1000ms | < 1500ms |
| Throughput | 100 req/s | 80 req/s |
| Error rate | < 0.1% | < 1% |
| Database queries/request | < 5 | < 10 |

### 3.4 Accessibility Testing

**Standard:** WCAG 2.1 Level AA

**Tools:** axe, Lighthouse

```typescript
// Accessibility test example
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('booking page should be accessible', async ({ page }) => {
  await page.goto('https://vacc.bpa.com.bd/book');
  
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  
  expect(results.violations).toEqual([]);
});
```

**Checklist:**
- [ ] All images have alt text
- [ ] Forms have proper labels
- [ ] Color contrast meets requirements
- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] Focus indicators visible

### 3.5 Compatibility Testing

| Browser | Versions | Priority |
|---------|----------|----------|
| Chrome | Latest, Latest-1 | High |
| Firefox | Latest, Latest-1 | High |
| Safari | Latest | High |
| Edge | Latest | Medium |
| Chrome Mobile | Latest | High |
| Safari Mobile | Latest | High |

**Devices:**
- iPhone 12/13/14 (Safari)
- Samsung Galaxy S21/S22 (Chrome)
- iPad (Safari)
- Android Tablet (Chrome)

---

## 4. Test Data Management

### 4.1 Test Data Requirements

```yaml
test_data:
  campaigns:
    - Active campaign with available slots
    - Campaign with no available slots
    - Future campaign (not yet started)
    - Past campaign (ended)
    
  locations:
    - Location with capacity
    - Location at capacity
    - Location with no slots today
    
  bookings:
    - Pending booking
    - Checked-in booking
    - Completed booking
    - Cancelled booking
    - No-show booking
    
  users:
    - New user (no BPA account)
    - Existing BPA user
    - User with existing pets
    - Staff with various roles
```

### 4.2 Test Data Generation

```typescript
// Test data factory
import { faker } from '@faker-js/faker';

export function createTestBooking(overrides: Partial<BookingData> = {}) {
  return {
    ownerPhone: faker.phone.number('017########'),
    ownerName: faker.person.fullName(),
    slotId: 1,
    pets: [
      {
        name: faker.animal.cat(),
        gender: faker.helpers.arrayElement(['MALE', 'FEMALE']),
        ageMonths: faker.number.int({ min: 3, max: 120 }),
      },
    ],
    ...overrides,
  };
}

export async function seedTestData() {
  // Create test campaign
  const campaign = await prisma.campaign.create({
    data: {
      name: 'Test Campaign',
      status: 'ACTIVE',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  
  // Create test location
  const location = await prisma.campaignLocation.create({
    data: {
      campaignId: campaign.id,
      name: 'Test Clinic',
      address: 'Test Address',
    },
  });
  
  // Create test slots
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    
    await prisma.campaignSlot.create({
      data: {
        locationId: location.id,
        date,
        startTime: '09:00',
        endTime: '12:00',
        capacity: 20,
      },
    });
  }
  
  return { campaign, location };
}
```

---

## 5. Bug Management

### 5.1 Bug Severity Levels

| Severity | Definition | Examples | SLA |
|----------|------------|----------|-----|
| Blocker | System unusable | Complete outage, data loss | 1 hour |
| Critical | Major feature broken | Can't book, payment fails | 4 hours |
| Major | Feature impaired | Slow response, partial failure | 1 day |
| Minor | Cosmetic/edge case | UI glitch, rare scenario | 3 days |
| Trivial | Polish | Typo, minor UI | Backlog |

### 5.2 Bug Report Template

```markdown
## Bug Report

**ID:** BUG-XXX
**Title:** [Brief description]

### Environment
- Browser/Device:
- URL:
- User Role:

### Steps to Reproduce
1. Step one
2. Step two
3. Step three

### Expected Behavior
What should happen

### Actual Behavior
What actually happens

### Screenshots/Videos
[Attach if applicable]

### Severity
[ ] Blocker [ ] Critical [ ] Major [ ] Minor [ ] Trivial

### Additional Context
Any other relevant information
```

---

## 6. Test Environment

### 6.1 Environment Configuration

| Environment | Purpose | Data | Access |
|-------------|---------|------|--------|
| Local | Development | Mock | Developers |
| Test | Integration | Synthetic | QA Team |
| Staging | Pre-prod | Copy of prod | Team + Stakeholders |
| Production | Live | Real | All users |

### 6.2 Test Environment Setup

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  api:
    build: .
    environment:
      - NODE_ENV=test
      - DATABASE_URL=postgresql://test:test@db:5432/campaign_test
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
      
  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=test
      - POSTGRES_PASSWORD=test
      - POSTGRES_DB=campaign_test
    volumes:
      - ./test-data:/docker-entrypoint-initdb.d
      
  redis:
    image: redis:7
```

---

## 7. Test Schedule

### 7.1 Pre-Launch Testing Timeline

| Week | Activity | Owner |
|------|----------|-------|
| -4 | Unit test completion | Dev Team |
| -4 | Integration test completion | Dev + QA |
| -3 | E2E test completion | QA Team |
| -3 | Security testing | Security Team |
| -2 | Performance testing | DevOps |
| -2 | UAT | Stakeholders |
| -1 | Regression testing | QA Team |
| -1 | Smoke tests on production | QA + DevOps |

### 7.2 Ongoing Testing

| Type | Frequency | Automation |
|------|-----------|------------|
| Unit tests | Every commit | CI pipeline |
| Integration tests | Every PR | CI pipeline |
| E2E critical paths | Daily | Scheduled |
| Performance baseline | Weekly | Scheduled |
| Security scan | Weekly | Scheduled |

---

## 8. Reporting

### 8.1 Test Metrics Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        QA METRICS DASHBOARD                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│   │    245      │  │    232      │  │     8       │  │    94.7%    │   │
│   │ Total Tests │  │   Passed    │  │   Failed    │  │  Pass Rate  │   │
│   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                                         │
│   CODE COVERAGE                           BUG STATUS                    │
│   ─────────────────────────               ──────────────                │
│   Statements: █████████░ 87%              Open:     12                  │
│   Branches:   ████████░░ 79%              In Progress: 5                │
│   Functions:  █████████░ 91%              Fixed:    45                  │
│   Lines:      █████████░ 86%              Verified: 42                  │
│                                                                         │
│   TREND (Last 7 Days)                                                   │
│   ─────────────────────────                                            │
│   Pass Rate:  93% → 94% → 95% → 94% → 95% → 95% → 95%                  │
│   Bugs Found:  3  →  2  →  4  →  2  →  1  →  2  →  1                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Exit Criteria

Before launch, all must be true:

- [ ] 100% critical test cases passed
- [ ] 95% overall test pass rate
- [ ] 0 Blocker bugs open
- [ ] 0 Critical bugs open
- [ ] All Major bugs triaged (fixed or accepted)
- [ ] Performance targets met
- [ ] Security scan passed
- [ ] UAT sign-off received
- [ ] Stakeholder approval obtained
