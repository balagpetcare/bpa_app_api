# Global Product Authenticity + Serial Issuance System Blueprint

**BPA / WorldPetsAssociation - Fake access and product copy risk mitigation**

*(Aligned with [BPA_STANDARD.md](../BPA_STANDARD.md), [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md), [GLOBAL_READY_PRODUCT_SYSTEM.md](./GLOBAL_READY_PRODUCT_SYSTEM.md).)*

---

## 1. Problem and goals

### Core problem

- 300-400+ companies' products; production in many countries / multiple factories.
- If someone gets "Serial generator access":
  - Can request extra serials for the same product and create **fake batches**.
  - Can copy another company's product and put **your system's genuine seal** on it.
- Tracking of which factory/batch produced what is lost.

### Goals

1. **Only real brand/factory/line** can issue serials.
2. Every serial is **tamper-proof**, **traceable**, **quota-controlled**, **audited**.
3. **Country-wise compliance** for product/packaging/contract rules.
4. Retail/customer scan verifies **authentic + origin + distribution legality**.

---

## 2. System overview (4 sub-systems)

| # | Sub-system | Purpose |
|---|-------------|---------|
| 1 | **Identity and compliance (KYC/KYB + contracts)** | Verify company/factory/production line; contracts, allowed countries, quota, licenses |
| 2 | **Product registry (product master + packaging signature)** | Register official description/spec per product; packaging design/label template versioned and fixed |
| 3 | **Secure serial issuance (crypto + quota + audit)** | Serial non-predictable; issuance tied to Product + Factory + Batch + Qty; sign/tokenize via HSM/Key Vault |
| 4 | **Verification and traceability (scan + chain-of-custody)** | QR/NFC/DataMatrix scan for genuine/fake; track distribution: Factory to Importer to Distributor to Shop to Customer |

---

## 3. Threat model and mitigations

| Threat | Mitigation |
|--------|-------------|
| **A) Fake company/fake factory onboarding** | KYB + contract + factory proof + periodic audit + risk scoring |
| **B) Real company credentials stolen** | MFA + device binding + IP allowlist + session risk + hardware key + limited scopes |
| **C) Over-issuance** | Contract quota + batch approval + dual control + anomaly detection |
| **D) Same product re-registered to get more serials** | Product fingerprint + similarity detection + approval workflow + immutable product master |
| **E) Serial copied onto many packets** | First-scan binding + tamper-evident label + dynamic challenge + fraud analytics |
| **F) Unauthorized sale in other country/market (grey)** | Country policy + route validation + "illegal distribution" flags |

---

## 4. Roles and permissions (RBAC)

### Global (platform team)

- **SUPER_ADMIN**: full access
- **COMPLIANCE_ADMIN**: KYB/KYC, contracts, audits
- **PRODUCT_REGISTRY_ADMIN**: product approval, packaging versioning
- **SECURITY_ADMIN**: keys, risk policies, incident response

### Company side

- **BRAND_OWNER**: company profile, product requests, quota request
- **FACTORY_ADMIN**: factory setup, production line, batch create
- **LINE_OPERATOR**: limited scope serial issuance (approved batches only)
- **DISTRIBUTOR/IMPORTER**: inbound/outbound shipment scan
- **RETAILER**: receive stock + sell scan

**Note (Implementation):** Role/Permission ভিত্তিক কোম্পানি সাইড অপারেশনগুলো Producer Portal‑এ রান করবে, আর লোকাল ডেভেলপমেন্টে এই পোর্টালটি `http://localhost:3105` এ অ্যাক্সেস হবে।

### Public

- **CUSTOMER**: scan verify only

---

## 5. Core data model (DB blueprint)

### 5.1 Organization and verification

- **Organization** (brand/company) - maps to existing BPA Organization
- **OrganizationLegalProfile** (KYB status, docs, risk score) - existing table; extend if needed
- **Factory** (country, address, license, verified status)
- **ProductionLine** (factory_id, line_code, device_binding)
- **User** + **Role** + **Permission** (existing + new roles above)

### 5.2 Product registry

- **Product** (brand_id, sku, name, category, status) - aligns with MasterProductCatalog / Product
- **ProductVersion** (product_id, version, description, ingredients/spec, images, regulatory tags)
- **PackagingTemplate** (product_version_id, label fields, QR placement, tamper label type)
- **ProductFingerprint** (text hash + image/perceptual hash + spec hash)

Rule: one product = immutable core + versioned specs. Changes = new ProductVersion; old version retained.

### 5.3 Contracts and quota

- **Contract** (brand_id, start/end, allowed_countries, channels, compliance rules)
- **QuotaPlan** (contract_id, product_id, per_month/per_batch limits)
- **QuotaUsage** (batch_id, issued_qty, remaining_qty)

### 5.4 Batch and serial

- **Batch** (product_version_id, factory_id, line_id, mfg_date, exp_date, requested_qty, approved_qty, status)
- **SerialRange** (batch_id, qty, issued_at, issued_by, status)
- **Serial**
  - serial_code (random/opaque)
  - signature (server sign)
  - status (ISSUED/PRINTED/ACTIVATED/SOLD/RECALLED/VOID)
  - first_scan_at, first_scan_geo, first_scan_device
  - current_owner_channel (factory/distributor/retailer)

### 5.5 Traceability (chain-of-custody)

- **Shipment** (from_party, to_party, country, channel, status)
- **ShipmentItem** (serial_code or carton_code)
- **ScanEvent** (serial_code, actor_role, location, time, action: PRODUCED/SHIPPED/RECEIVED/SOLD/VERIFY)

---

## 6. Serial/QR security design (critical)

### 6.1 Serial structure (opaque + signed)

QR content:

- **sid** = 16-24 bytes random (base32/base64url)
- **v** = schema version
- **sig** = server-side digital signature (Ed25519/ECDSA) over (sid + product_version_id + batch_id + expiry)

QR does **not** contain product details; only opaque id + signature. Guessing or forging without key is infeasible.

### 6.2 Key management

- Signing key in **HSM/KeyVault** (cloud KMS acceptable)
- API server never sees raw private key; only "sign" request
- Key rotation policy (e.g. every 90 days)

### 6.3 Quota enforcement

Serial issuance **only** from approved batch:

- Batch request to compliance approval to quota lock to issuance
- Issuance API always requires: product_version_id + factory_id + line_id + approved_qty (no "free generate")

### 6.4 Dual-control (optional, high-value brands)

- Batch approve: 2-person approval (e.g. Factory Admin + Brand Owner / Compliance)

---

## 7. Preventing "same product, many serials" (product fingerprint)

### 7.1 Product fingerprint engine

- Product description + ingredients/spec + key images to hash
- On new product register: similarity check (text embedding, image pHash, spec match)
- If similarity high: **manual review required**
- Issuance only from **approved product versions**

### 7.2 Immutable product identity

- Product once approved: core fields restricted
- Changes: new **ProductVersion**; each version has its own compliance tags (country-wise approval)

---

## 8. Packaging and anti-copy (physical layer, optional)

- Tamper-evident hologram/void label + QR across seal
- NFC tag (premium SKU)
- Microtext / UV ink (enterprise)
- Carton-level code + unit-level code (aggregation: one carton scan tracks shipment)

---

## 9. Verification logic (what scan returns)

### 9.1 Customer scan response

- Authentic / Suspicious / Already scanned many times
- Brand name, product name, expiry, official images
- "This unit first verified at: (date + country)" (privacy-safe)
- Recall alert if recalled

### 9.2 Fraud signals

- Same serial many locations in short time
- First-scan country not in contract allowed countries
- Too many verify scans (counterfeit sharing)
- Shipment chain broken (never received but sold)

---

## 10. End-to-end workflow

### Step A: Company onboarding

1. Company applies (KYB docs, trade license, brand proof)
2. Compliance verifies
3. Contract created (allowed countries, channels, quota)
4. Factories + lines registered (verification + device binding)

### Step B: Product registration

1. Brand Owner creates Product + ProductVersion (description/spec/images)
2. Fingerprint engine checks duplicates/similarity
3. Registry Admin approves
4. Packaging template approved

### Step C: Batch and issuance

1. Factory requests Batch (qty, mfg/exp, line)
2. System checks quota + contract
3. Approval (optional dual control)
4. Issuance generates qty serials (signed)
5. Factory prints QR (label rules enforced)

### Step D: Distribution tracking

1. Factory ships; distributor scans carton/units
2. Distributor receives; scan confirm
3. Retailer receives; scan confirm
4. Retail sale: "sold" scan (POS)
5. Customer verify scan: authenticity result

---

## 11. API design (module map)

### Auth/identity

- POST /auth/login (MFA)
- POST /org/apply
- POST /org/:id/verify
- POST /factory/:id/verify
- POST /line/:id/bind-device

### Product registry

- POST /products
- POST /products/:id/versions
- POST /products/:id/approve
- GET /products/:id/public (public verify display)

### Contract/quota

- POST /contracts
- POST /quota/plans
- GET /quota/usage?product_version_id=...

### Batch/serial

- POST /batches
- POST /batches/:id/approve
- POST /batches/:id/issue-serials (scoped, audited)
- GET /serials/:sid/verify (public)
- POST /serials/:sid/scan-event (authorized actors)

### Traceability

- POST /shipments
- POST /shipments/:id/dispatch
- POST /shipments/:id/receive

---

## 12. UI/portal (summary)

| Portal | Users | Main functions |
|--------|-------|-----------------|
| Brand portal | Owner/Admin | Company profile, verification, contracts, quota, product registry, fraud analytics, recall |
| Factory portal | Factory Admin, Line Operator | Lines, batch request, issuance, print export, shipment dispatch |
| Distributor/retail portal | Distributor, Retailer | Receive shipments, stock by serials, POS sale scan |
| Public verify | Customer | Scan result, product info, warnings |

**Dev note (Producer portal):** Local environment-এ Producer/Factory users এই সিস্টেমটি `http://localhost:3105` পোর্ট থেকে ব্যবহার করবে।

---

## 13. Monitoring, audit, incident response

- **Audit trails (immutable):** who issued how many serials when; which batch approved; which device; first-scan location
- **Alerts:** over-issuance attempts; many scans same serial; country mismatch; abnormal issuance patterns
- **Actions:** suspend line/device; freeze batch; recall product version; blacklist org until re-verify

---

## 14. Country-wise policy / compliance engine

- **CountryPolicy** (or existing policy tables): product category restrictions, labeling requirements, allowed sales channels
- Verify endpoint returns country-appropriate "what to show"

---

## 15. Minimum viable implementation (MVP)

1. KYB + Org/Factory verification status
2. Product registry with ProductVersion + approval
3. Batch approval + quota + secure issuance (signed QR)
4. Public verify endpoint + scan event logging
5. Basic fraud rules (duplicate scans, country mismatch)

**Phase-2:** aggregation, NFC, advanced analytics, dual-control, recall workflows.

---

## 16. Why this design prevents product copy

- **Fake company** cannot onboard (KYB + contract).
- **Even with access**, cannot issue serials at will (batch approval + quota lock).
- **QR forgery** is hard (invalid without correct signature).
- **Serial copy** is detectable (first-scan binding + anomaly).
- **Same product, many serials** is blocked (fingerprint + approval gating).

---

## 17. Fit with BPA / WorldPetsAssociation

- **Brand** = Organization (existing tenant).
- **Factory** = sub-entity under Organization (new: Factory table linked to Organization).
- **Product authenticity module** = separate bounded context; existing Product / MasterProductCatalog evolve toward ProductVersion + fingerprint; new: Batch, Serial, Shipment, ScanEvent.
- **Admin panel:** global compliance and monitoring; Country Policy Engine gates features and rules.

Existing BPA: Organization, Branch, OrganizationLegalProfile, Product, MasterProductCatalog. This blueprint adds: Factory, ProductionLine, ProductVersion, PackagingTemplate, ProductFingerprint, Contract, QuotaPlan, QuotaUsage, Batch, SerialRange, Serial, Shipment, ShipmentItem, ScanEvent, and extended roles.

---

## Related documentation

| Doc | Topic |
|-----|--------|
| [BPA_STANDARD.md](../BPA_STANDARD.md) | Ports, code change policy |
| [GLOBAL_READY_PRODUCT_SYSTEM.md](./GLOBAL_READY_PRODUCT_SYSTEM.md) | GPR, Serialization, Supply chain, description lock |
| [GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md](./GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md) | 3-layer, RBAC, country roles |
| [GLOBAL_READY_FULL_PLANNING.md](./GLOBAL_READY_FULL_PLANNING.md) | Full planning, phases, next steps |
