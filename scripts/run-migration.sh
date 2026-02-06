#!/bin/bash

# Branch Access Permissions Migration Script
# This script automates the migration process

set -e  # Exit on error

echo "=========================================="
echo "Branch Access Permissions Migration"
echo "=========================================="
echo ""

# Step 1: Generate Prisma Client
echo "Step 1: Generating Prisma Client..."
npx prisma generate
echo "✅ Prisma Client generated"
echo ""

# Step 2: Apply Migration
echo "Step 2: Applying migration..."
npx prisma migrate deploy
echo "✅ Migration applied"
echo ""

# Step 3: Verify Migration
echo "Step 3: Verifying migration status..."
npx prisma migrate status
echo ""

# Step 4: Run Backfill
echo "Step 4: Running backfill script..."
npx ts-node scripts/backfill-branch-access-permissions.ts
echo ""

echo "=========================================="
echo "✅ Migration completed successfully!"
echo "=========================================="
