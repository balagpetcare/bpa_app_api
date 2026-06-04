# Security and Performance Plan For Location Master Migration

## Objective

Ensure the centralized location system remains safe, correct, and performant under multi-module BPA/WPA usage.

## 1) Security Requirements

## A. Access control

- Public/standard users: read-only access to location master query endpoints.
- Admin/service operators: restricted access to import/verify/version activation endpoints.
- Enforce RBAC for all mutation/admin location operations.

## B. Input validation

For all write APIs using location IDs:

- strict type checks
- existence checks
- parent-child consistency checks
- optional leaf validation (`areaId` must belong to selected `unionId`)

Reject partial invalid location payloads with deterministic error codes.

## C. Audit logging

Log the following events:

- seed import start/finish/failure
- verify run start/finish/failure
- seed version activation
- manual admin edits (if any)
- repeated hierarchy mismatch attempts

## D. Abuse prevention

- rate-limit search and geocode-like endpoints.
- cap pagination and query lengths.
- protect admin endpoints with stronger auth and IP/service controls where possible.

## 2) Data Integrity Controls

1. FK constraints between hierarchy levels.
2. Parent-scoped unique code constraints.
3. Duplicate detection tooling in verify pipeline.
4. Scheduled integrity checks with alerting.
5. Migration backfill confidence tracking and manual review queue.

## 3) Performance Design

## A. Query indexing

- indexes on each parent FK (`division_id`, `district_id`, `upazila_id`, `union_id`)
- searchable columns (`name_en`, `name_bn`, `slug`, `code`)
- optional composite indexes for common filtered queries

## B. Caching strategy

- cache stable master lookups (divisions/districts/upazilas/unions)
- cache version metadata (`seed/version`)
- include cache invalidation on new seed activation

## C. API efficiency

- enforce pagination defaults and limits
- avoid over-fetching deep trees unless requested
- provide lightweight list DTO and optional detailed resolve endpoint

## D. Mobile/web optimization

- client-side parent-level cache
- debounce search input
- prefetch predictable child levels where useful

## 4) Reliability and Observability

Track metrics:

- request latency by endpoint
- cache hit ratio
- hierarchy validation failure count
- unknown/invalid location ID write attempts
- import/verify success rate and runtime

Alert on:

- sustained latency spikes
- rising mismatch errors after deployment
- import verification failures

## 5) Privacy Considerations

Location master data itself is non-PII, but module records may contain address and coordinates.

Controls:

- minimize logging of full user address payloads
- mask sensitive fields in logs
- limit retention of raw geocode responses when not needed

## 6) Operational Safety During Migration

1. Feature-flag strict validation rollout.
2. Deploy in stages with shadow checks before hard enforcement.
3. Keep compatibility endpoints active until client adoption crosses threshold.
4. Maintain rollback toggles for validation strictness and endpoint routing.

## 7) Security/Performance Exit Criteria

- No critical authorization gaps in admin location operations.
- P95 latency remains within agreed target for list and search endpoints.
- Integrity checks pass across all hierarchy levels.
- Mismatch/error trend is stable or decreasing after cutover.
