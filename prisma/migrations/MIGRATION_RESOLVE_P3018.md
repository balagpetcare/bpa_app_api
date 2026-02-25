# Resolve P3018 / P3015 after duplicate Country migration

## P3018 – migration failed ("countries" already exists)

If you saw:

- **P3018**: A migration failed to apply. New migrations cannot be applied before the error is recovered from.
- **Migration name**: `20260129000000_add_global_country_policy`
- **Database error**: `relation "countries" already exists`

The tables were created by `20260129000000_add_country_and_policy_tables`. The duplicate migration has been removed.

## P3015 – migration file not found

If you saw:

- **P3015**: Could not find the migration file at `prisma\migrations\20260129000000_add_global_country_policy\migration.sql`. Please delete the directory or restore the migration file.

Then:

1. **Remove the directory** (if it still exists): delete the folder `prisma/migrations/20260129000000_add_global_country_policy` entirely (do not leave an empty folder).
2. **Mark the migration as rolled back** (with PostgreSQL running):

```bash
npx prisma migrate resolve --rolled-back 20260129000000_add_global_country_policy
```

Then run:

```bash
npx prisma migrate deploy
```

Deploy should succeed with no pending migrations.
