# Bangladesh Pet Products Master Catalog CSV

**File:** `bd_pet_products_master_catalog.csv`

## Overview

Pre-built Master Product Catalog CSV with **26 pet products** available in Bangladesh, collected from:

- **Mew Mew Shop BD** (mewmewshopbd.com) – cat dry food, treats
- **Pet Zone BD** (petzonebd.com) – Royal Canin cat/dog, wet pouches
- **Daraz** (daraz.com.bd) – Pedigree dog food
- **Miki Pet Store** (mikipetstore.com) – Pedigree, Whiskas

## Contents

| Category        | Examples                                        |
|----------------|--------------------------------------------------|
| Cat dry food   | SmartHeart, Whiskas, Reflex, Mito, Bona Meow, Cuties Catz, Bonacibo, Billi, Purina Friskies, Purina ONE, Zoi |
| Cat treats     | Pramy Nutri Treat (Chicken, Lamb)                |
| Cat wet food   | Royal Canin pouches, Whiskas wet 85g             |
| Dog dry food   | Royal Canin Maxi Adult, Pedigree Adult (3kg, 10kg, 20kg) |

Prices (MRP) are in **৳** (BDT). Each row has `external_source` and `external_product_id` for reference.

## Regenerate

```bash
npm run generate:bd-pet-csv
```

Output: `prisma/seeders/data/bd_pet_products_master_catalog.csv`

## Use in BPA

1. **Admin** → **Commerce & Catalog** → **Master Catalog** → **Import CSV**
2. Click **Bangladesh Sample** to download this file (or use **Download Template** for empty).
3. Optionally edit the CSV, then **Upload CSV**.
4. Use **Dry run** first to validate, then import.

The API serves this file at `GET /api/v1/products/master-catalog/bd-sample` (authenticated).
