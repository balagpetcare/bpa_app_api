# Animal Taxonomy: Mandatory "Local / Indigenous" Breed

## Business rule

Every animal type must have at least one breed option representing local/native/indigenous animals. The canonical label is **"Local / Indigenous"**.

## Implementation

- **Canonical name:** `Local / Indigenous` (constant: `LOCAL_INDIGENOUS_BREED_NAME` in `prisma/seeders/seedAnimalTaxonomy.ts`).
- **Aliases:** Stored in `Breed.aliasNames` (JSON array): `["Local", "Indigenous", "Deshi", "Native"]` so search/UI can match without duplicate rows.
- **Uniqueness:** `Breed` has `@@unique([name, animalTypeId])`; one "Local / Indigenous" row per animal type.

## Seed

- `seedAnimalTaxonomy` seeds all types and then runs an **ensure step** that creates or migrates to "Local / Indigenous" for every animal type. Legacy names ("Local / Deshi", "Local", "Indigenous", "Native", "Deshi") are updated in place to the canonical name and alias list.
- Dog’s previous "Local / Deshi" entry is seeded as "Local / Indigenous" with aliasNames including "Deshi" and "Local Dog".

## Adding a new animal type

When creating a new animal type (e.g. future admin flow), call:

```ts
import { ensureLocalIndigenousBreedForType } from "./seeders/seedAnimalTaxonomy"; // or your path to prisma/seeders

await ensureLocalIndigenousBreedForType(prisma, newAnimalTypeId);
```

This creates the "Local / Indigenous" breed for that type (or migrates an existing legacy-named breed).

## Files

- `prisma/seeders/seedAnimalTaxonomy.ts`: constants, seed logic, ensure step, `ensureLocalIndigenousBreedForType`.
- `prisma/seeders/seedAnimalTypesAndBreeds.ts`: includes "Local / Indigenous" for Dog and Cat when that seed is used.
