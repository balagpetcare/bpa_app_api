# Payout System Design (Future Module)

## Overview

Organization payout configuration is **separate from organization registration**. Banking and payout details are collected only on `/owner/organizations/[id]/payouts`. Organization creation does **not** require any banking information and must not be blocked by missing payout setup.

## Current State

- **Organization.payoutStatus** (enum: `NOT_CONFIGURED` | `PENDING_APPROVAL` | `CONFIGURED` | `REJECTED`) defaults to `NOT_CONFIGURED` on creation.
- **Owner UI**: Registration wizard (`/owner/organizations/new`) and edit no longer include banking/payout fields. A dedicated **Payouts** page exists at `/owner/organizations/[id]/payouts` (placeholder until the full module is implemented).
- **API**: Legal profile endpoints do not accept banking fields. Payout data will be managed via dedicated payout endpoints (see below).

## Design Principles

1. **Country-based providers**  
   Payout providers (bank, mobile, wallet, global gateways) are configurable **per country**. An organization can only use providers enabled for its `organization.countryId`.

2. **Provider-agnostic architecture**  
   Support multiple channel types without schema changes:
   - Bank (account + routing, etc.)
   - Mobile money (MFS: bKash, Nagad, Rocket, etc.)
   - Wallets
   - Global gateways (e.g. PayPal, Stripe Connect)
   New countries and providers are added via configuration (e.g. `PayoutProvider` / `PayoutMethodCatalog` per country), **not** by hardcoding bank lists or new columns.

3. **No hardcoded bank lists**  
   Provider options (including bank names, branch lists, MFS types) must be **configurable per country** (e.g. admin-configurable catalog or seed data). International expansion must be possible without schema changes.

4. **Security**
   - **Encrypted storage**: Store account/identifier details in an encrypted form (e.g. AES-256-GCM), similar to existing `payoutDetailsCrypto` for wallet withdraws.
   - **Provider-specific validation**: Validate payloads per provider type (format, length, checksums where applicable).
   - **Admin approval flow**: New or updated payout accounts can require admin review before status moves to `CONFIGURED`; `payoutStatus` supports `PENDING_APPROVAL` and `REJECTED`.

## Proposed Data Model (Future)

- **OrganizationPayoutAccount** (or similar):
  - `orgId`, `countryId` (denormalized or from org)
  - `providerKey` (e.g. `bank`, `bkash`, `nagad`, `stripe_connect`) — references a provider config per country
  - `encryptedDetailsJson` — encrypted payload of provider-specific fields (account number, routing, phone, etc.)
  - `status`: DRAFT | PENDING_APPROVAL | APPROVED | REJECTED
  - `reviewedByAdminId`, `reviewedAt`, `rejectionReason`
- **PayoutProvider** (or catalog table) per country:
  - `countryId`, `providerKey`, `providerType` (BANK | MFS | WALLET | GATEWAY), `name`, `configJson` (e.g. validation rules, optional bank/branch list references), `isActive`
  - No hardcoded bank lists; lists come from config or separate admin-managed tables.

## API (Future)

- `GET /api/v1/owner/organizations/:id/payouts` — list payout accounts (masked); return available providers for org’s country.
- `POST /api/v1/owner/organizations/:id/payouts` — add payout account (encrypt, validate per provider, optionally set status to PENDING_APPROVAL).
- `PATCH /api/v1/owner/organizations/:id/payouts/:accountId` — update (same validation and encryption).
- `DELETE /api/v1/owner/organizations/:id/payouts/:accountId` — soft delete or revoke.
- Admin: approve/reject payout account; update `Organization.payoutStatus` when appropriate.

## Contract and Compatibility

- **Existing API contracts** are unchanged except for the addition of `payoutStatus` on Organization (additive).
- Organization creation request/response does **not** require banking fields; creation is never blocked by missing banking info.
- Legacy `OrganizationLegalProfile` banking columns (if still present) are **not** used for new flows; new payout data lives in the dedicated payout module and encrypted storage.

## References

- Existing wallet payout: `wallet.service` / `payout_orchestrator` and `payoutDetailsCrypto` for encryption.
- Organization creation: `owner.controller` `createOrganization`; default `payoutStatus = NOT_CONFIGURED`.
- Owner UI: `app/owner/organizations/[id]/payouts/page.jsx` (placeholder); registration and edit forms no longer collect banking/payout.
