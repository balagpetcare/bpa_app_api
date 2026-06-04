# Deployment Plan

## 2026 Cat Flu + Rabies Vaccination Campaign

---

## 1. Deployment Overview

### 1.1 Deployment Strategy

| Component | Strategy | Environment |
|-----------|----------|-------------|
| Backend API | Rolling update | Existing BPA infrastructure |
| Campaign Website | Static + SSR | New Vercel/CloudFlare deployment |
| Database | Schema extension | Existing PostgreSQL |
| Redis | Reuse existing | Existing Redis cluster |

### 1.2 Timeline

```
Week -4: Development complete, feature freeze
Week -3: Staging deployment, integration testing
Week -2: UAT, performance testing, bug fixes
Week -1: Production deployment, soft launch
Week 0:  Campaign go-live
```

---

## 2. Infrastructure Requirements

### 2.1 Existing Infrastructure (Reused)

| Component | Current Spec | Campaign Impact |
|-----------|--------------|-----------------|
| API Servers | 2x 4vCPU, 8GB | +20% CPU expected |
| PostgreSQL | 16GB RAM, 500GB SSD | +10GB data |
| Redis | 4GB | +1GB for sessions |
| MinIO/S3 | 100GB | +5GB for QR/PDFs |

### 2.2 New Infrastructure

| Component | Specification | Purpose |
|-----------|---------------|---------|
| Campaign Website | Vercel Pro | vacc.bpa.com.bd |
| CDN | CloudFlare | Static assets, caching |
| SMS Gateway | SSL Wireless | Campaign SMS |

### 2.3 Scaling Thresholds

```yaml
# Auto-scaling rules
api_servers:
  min_instances: 2
  max_instances: 6
  scale_up:
    cpu_threshold: 70%
    duration: 2m
  scale_down:
    cpu_threshold: 30%
    duration: 10m

database:
  connection_pool:
    min: 20
    max: 100
  read_replicas: 1 (activate if needed)
```

---

## 3. Database Deployment

### 3.1 Schema Migration

> **IMPORTANT**: This section documents planned schema changes for reference.
> Actual migration will be executed separately by the DBA team.

```sql
-- Migration: 20260601000000_add_campaign_tables

-- 1. Create new tables (see 04-database-design.md for full schema)
-- Campaign, CampaignLocation, CampaignSlot, CampaignVaccineType,
-- CampaignBooking, CampaignPet, CampaignStaff, CampaignSmsTemplate,
-- CampaignSmsLog, CampaignAuditLog

-- 2. Add indexes for performance
CREATE INDEX CONCURRENTLY idx_campaign_booking_phone 
ON campaign_bookings(owner_phone);

CREATE INDEX CONCURRENTLY idx_campaign_booking_slot 
ON campaign_bookings(slot_id);

CREATE INDEX CONCURRENTLY idx_campaign_pet_status 
ON campaign_pets(vaccination_status);

-- 3. Add foreign key constraints
-- (see 04-database-design.md)
```

### 3.2 Migration Execution Plan

```bash
# Pre-migration checklist
# - [ ] Backup database
# - [ ] Test migration on staging
# - [ ] Schedule maintenance window (if needed)
# - [ ] Notify team

# Migration steps
# 1. Apply migration in transaction
prisma migrate deploy

# 2. Verify tables created
psql -c "\dt campaign_*"

# 3. Verify indexes
psql -c "\di | grep campaign"

# 4. Test basic queries
psql -c "SELECT COUNT(*) FROM campaigns"
```

### 3.3 Rollback Plan

```sql
-- Rollback migration (if needed)
-- Note: Only safe before campaign data exists

DROP TABLE IF EXISTS campaign_audit_logs CASCADE;
DROP TABLE IF EXISTS campaign_sms_logs CASCADE;
DROP TABLE IF EXISTS campaign_sms_templates CASCADE;
DROP TABLE IF EXISTS campaign_staff CASCADE;
DROP TABLE IF EXISTS campaign_pets CASCADE;
DROP TABLE IF EXISTS campaign_bookings CASCADE;
DROP TABLE IF EXISTS campaign_vaccine_types CASCADE;
DROP TABLE IF EXISTS campaign_slots CASCADE;
DROP TABLE IF EXISTS campaign_locations CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
```

---

## 4. Backend Deployment

### 4.1 Code Changes

```
src/api/v1/modules/
├── campaign/               # New module
│   ├── campaign.controller.ts
│   ├── campaign.service.ts
│   ├── campaign.routes.ts
│   ├── booking.controller.ts
│   ├── booking.service.ts
│   ├── checkin.controller.ts
│   ├── checkin.service.ts
│   ├── vaccination.controller.ts
│   ├── vaccination.service.ts
│   ├── certificate.controller.ts
│   ├── certificate.service.ts
│   ├── sms.service.ts
│   └── admin.controller.ts
└── index.ts                # Update to include campaign routes
```

### 4.2 Environment Variables

```bash
# New environment variables for campaign
CAMPAIGN_JWT_SECRET=<secure-random-string>
CAMPAIGN_OTP_EXPIRY_SECONDS=300
CAMPAIGN_CERT_SIGNING_KEY=<signing-key>
CAMPAIGN_SITE_URL=https://vacc.bpa.com.bd

# SMS gateway (if using different account)
CAMPAIGN_SMS_SENDER_ID=BPA-VAC

# Feature flags
FEATURE_CAMPAIGN_ENABLED=true
FEATURE_CAMPAIGN_PAYMENTS=true
```

### 4.3 Deployment Steps

```bash
# 1. Build and test
npm run build
npm run test

# 2. Deploy to staging
git push origin main:staging

# 3. Run staging tests
npm run test:e2e:staging

# 4. Deploy to production
# Using blue-green deployment
./scripts/deploy-production.sh

# 5. Verify deployment
curl https://api.bpa.com.bd/health
curl https://api.bpa.com.bd/api/v1/campaigns
```

### 4.4 Blue-Green Deployment Script

```bash
#!/bin/bash
# scripts/deploy-production.sh

set -e

echo "Starting blue-green deployment..."

# Current active environment
CURRENT=$(kubectl get service bpa-api -o jsonpath='{.spec.selector.version}')
echo "Current active: $CURRENT"

# New environment
if [ "$CURRENT" == "blue" ]; then
  NEW="green"
else
  NEW="blue"
fi
echo "Deploying to: $NEW"

# Deploy new version
kubectl set image deployment/bpa-api-$NEW \
  bpa-api=bpa/api:$VERSION

# Wait for rollout
kubectl rollout status deployment/bpa-api-$NEW --timeout=5m

# Run smoke tests on new deployment
./scripts/smoke-test.sh bpa-api-$NEW

# Switch traffic
kubectl patch service bpa-api -p \
  "{\"spec\":{\"selector\":{\"version\":\"$NEW\"}}}"

echo "Deployment complete. Active: $NEW"

# Keep old version running for 10 minutes for quick rollback
echo "Old version ($CURRENT) available for rollback for 10 minutes"
sleep 600

# Scale down old version
kubectl scale deployment/bpa-api-$CURRENT --replicas=0
```

---

## 5. Campaign Website Deployment

### 5.1 Vercel Configuration

```json
// vercel.json
{
  "name": "bpa-vaccination-campaign",
  "framework": "nextjs",
  "regions": ["sin1"],
  "env": {
    "NEXT_PUBLIC_API_URL": "@campaign_api_url",
    "NEXT_PUBLIC_SITE_URL": "@campaign_site_url"
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    }
  ],
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://api.bpa.com.bd/api/v1/:path*"
    }
  ]
}
```

### 5.2 Domain Configuration

```
vacc.bpa.com.bd -> Vercel (campaign site)
staff.vacc.bpa.com.bd -> Vercel (staff portal)
api.bpa.com.bd/api/v1/campaign-* -> Existing API
```

### 5.3 Deployment Steps

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Link project
vercel link

# 3. Deploy to preview
vercel

# 4. Test preview deployment
# Manually verify all pages

# 5. Deploy to production
vercel --prod

# 6. Verify DNS
dig vacc.bpa.com.bd
```

---

## 6. Pre-Deployment Checklist

### 6.1 Code Review

- [ ] All PRs reviewed and merged
- [ ] Security review completed
- [ ] No console.log statements
- [ ] Error handling verified
- [ ] API documentation updated

### 6.2 Testing

- [ ] Unit tests passing (>80% coverage)
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] Load testing completed
- [ ] Security scanning completed

### 6.3 Infrastructure

- [ ] SSL certificates valid
- [ ] DNS configured
- [ ] CDN configured
- [ ] Monitoring dashboards set up
- [ ] Alerts configured
- [ ] Backup verified

### 6.4 Data

- [ ] Database migration tested
- [ ] Initial data seeded (vaccine types, etc.)
- [ ] Test campaign created

### 6.5 Operations

- [ ] Runbook documented
- [ ] On-call schedule set
- [ ] Escalation path defined
- [ ] Rollback plan tested

---

## 7. Post-Deployment Verification

### 7.1 Smoke Tests

```typescript
// scripts/smoke-tests.ts
const tests = [
  { name: 'API Health', url: '/health', expect: 200 },
  { name: 'Campaign List', url: '/api/v1/campaigns', expect: 200 },
  { name: 'OTP Request', url: '/api/v1/campaign-otp', method: 'POST', expect: 200 },
  { name: 'Campaign Page', url: 'https://vacc.bpa.com.bd', expect: 200 },
  { name: 'Staff Login', url: 'https://staff.vacc.bpa.com.bd/login', expect: 200 },
];

async function runSmokeTests() {
  for (const test of tests) {
    const res = await fetch(test.url, { method: test.method || 'GET' });
    const status = res.status === test.expect ? '✓' : '✗';
    console.log(`${status} ${test.name}: ${res.status}`);
  }
}
```

### 7.2 Monitoring Dashboard

```yaml
# Grafana dashboard config
panels:
  - title: "Campaign API Requests/sec"
    targets:
      - expr: rate(http_requests_total{path=~"/api/v1/campaign.*"}[5m])
    
  - title: "Campaign Booking Success Rate"
    targets:
      - expr: rate(campaign_bookings_created_total[5m])
    
  - title: "OTP Send Success Rate"
    targets:
      - expr: rate(sms_sent_total{type="campaign_otp"}[5m])
    
  - title: "Database Query Latency (p95)"
    targets:
      - expr: histogram_quantile(0.95, rate(prisma_query_duration_bucket[5m]))
```

### 7.3 Alert Configuration

```yaml
# alertmanager rules
groups:
  - name: campaign
    rules:
      - alert: HighBookingFailureRate
        expr: rate(campaign_booking_errors_total[5m]) > 0.1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High booking failure rate"
          
      - alert: SMSDeliveryFailure
        expr: rate(sms_delivery_failed_total{type="campaign"}[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "SMS delivery failures increasing"
          
      - alert: APILatencyHigh
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{path=~"/api/v1/campaign.*"}[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Campaign API latency high"
```

---

## 8. Rollback Procedures

### 8.1 Backend Rollback

```bash
# Immediate rollback (switch traffic)
./scripts/rollback.sh

# rollback.sh
#!/bin/bash
CURRENT=$(kubectl get service bpa-api -o jsonpath='{.spec.selector.version}')
if [ "$CURRENT" == "blue" ]; then
  kubectl patch service bpa-api -p '{"spec":{"selector":{"version":"green"}}}'
else
  kubectl patch service bpa-api -p '{"spec":{"selector":{"version":"blue"}}}'
fi
```

### 8.2 Database Rollback

```sql
-- Only possible before campaign data exists
-- After data exists, use forward migrations to fix issues

-- Check if safe to rollback
SELECT COUNT(*) FROM campaign_bookings;
-- If > 0, DO NOT rollback schema

-- If safe:
-- Run rollback migration
```

### 8.3 Frontend Rollback

```bash
# Vercel allows instant rollback to previous deployment
vercel rollback
```

---

## 9. Go-Live Checklist

### 9.1 Day Before Go-Live

- [ ] Final staging verification
- [ ] Production deployment complete
- [ ] DNS propagated
- [ ] SSL working
- [ ] Team briefed
- [ ] Support team ready
- [ ] Marketing materials ready

### 9.2 Go-Live Day

- [ ] Enable feature flags
- [ ] Activate campaign in admin
- [ ] Send launch SMS/notification
- [ ] Monitor dashboards
- [ ] War room active
- [ ] Backup on-call available
