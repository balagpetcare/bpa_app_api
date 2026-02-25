# Branch Access Permissions Migration

## Quick Commands

```bash
# 1. Generate Prisma Client
npx prisma generate

# 2. Apply Migration
npx prisma migrate deploy

# 3. Backfill Existing Members
npx ts-node ../../scripts/backfill-branch-access-permissions.ts
```

## Or Use npm Script

```bash
npm run migrate:branch-access
```

## What This Migration Does

1. Creates `BranchAccessPermissionStatus` enum (PENDING, APPROVED, REVOKED, EXPIRED)
2. Creates `branch_access_permissions` table
3. Adds new notification types to `NotificationType` enum
4. Sets up foreign keys and indexes

## After Migration

Run the backfill script to grant existing staff APPROVED access:
```bash
npm run backfill:branch-access
```

## Files

- `migration.sql` - Database migration SQL
- `backfill_existing_members.ts` - Backfill script (alternative location)
- `MIGRATION_GUIDE.md` - Detailed migration guide

## See Also

- `../../MIGRATION_COMMANDS.md` - Complete command reference
- `../../scripts/backfill-branch-access-permissions.ts` - Main backfill script
