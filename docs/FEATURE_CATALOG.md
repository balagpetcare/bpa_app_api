# Feature Catalog (Country Policy Features)

Purpose: master list of feature codes used by policy engine and UI gating.

## 1) Core features (initial set)

| Feature Code | Description | Default for new country |
| --- | --- | --- |
| DONATION | Donations and fundraising flows | OFF |
| FUNDRAISING | Campaign creation / approvals | OFF |
| ADS | Ads system and serving | OFF |
| PRODUCTS | Product catalog and inventory | ON |
| POS | Point of sale | ON |
| ORDERS | Orders and fulfillment | ON |
| CLINIC | Clinic services and appointments | ON |
| ADOPTION | Adoption workflows | OFF |
| RESCUE | Rescue workflows | OFF |
| FOSTER | Foster workflows | OFF |
| SHELTER | Shelter workflows | OFF |
| SERVICES | Service marketplace | ON |
| DELIVERY | Delivery hub features | ON |

## 2) Policy rules (examples)

These are *not* features. They are rule keys used by policy guard.

- `donation.max_per_tx`
- `donation.max_per_day`
- `fundraising.require_ngoreg`
- `adoption.require_nid`
- `ads.require_kyc`

## 3) Process for adding a feature

1. Add feature code to this catalog.
2. Seed default value in policy for BD.
3. Add `requireFeature(FEATURE_CODE)` in API routes.
4. Gate UI using `/api/v1/meta/features`.

