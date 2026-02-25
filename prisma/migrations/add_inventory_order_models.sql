-- Migration: Add Inventory and Order models for MVP
-- Run: npx prisma migrate dev --name add_inventory_order_models

-- Inventory Model
CREATE TABLE IF NOT EXISTS "inventory" (
  "id" SERIAL PRIMARY KEY,
  "branch_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "variant_id" INTEGER,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "min_stock" INTEGER NOT NULL DEFAULT 10,
  "expiry_date" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
  CONSTRAINT "inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE,
  CONSTRAINT "inventory_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "inventory_branch_id_idx" ON "inventory"("branch_id");
CREATE INDEX IF NOT EXISTS "inventory_product_id_idx" ON "inventory"("product_id");
CREATE INDEX IF NOT EXISTS "inventory_variant_id_idx" ON "inventory"("variant_id");

-- Stock Transaction Model (for tracking stock changes)
CREATE TABLE IF NOT EXISTS "stock_transactions" (
  "id" SERIAL PRIMARY KEY,
  "inventory_id" INTEGER NOT NULL,
  "type" VARCHAR(20) NOT NULL, -- 'IN', 'OUT', 'ADJUST', 'TRANSFER'
  "quantity" INTEGER NOT NULL,
  "reason" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_transactions_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE CASCADE,
  CONSTRAINT "stock_transactions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "stock_transactions_inventory_id_idx" ON "stock_transactions"("inventory_id");
CREATE INDEX IF NOT EXISTS "stock_transactions_created_at_idx" ON "stock_transactions"("created_at");

-- Order Model
CREATE TABLE IF NOT EXISTS "orders" (
  "id" SERIAL PRIMARY KEY,
  "order_number" VARCHAR(50) UNIQUE NOT NULL,
  "branch_id" INTEGER NOT NULL,
  "customer_id" INTEGER,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'
  "total_amount" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  "payment_method" VARCHAR(20), -- 'CASH', 'CARD', 'MOBILE', 'ONLINE'
  "payment_status" VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'
  "notes" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
  CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "orders_branch_id_idx" ON "orders"("branch_id");
CREATE INDEX IF NOT EXISTS "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders"("status");
CREATE INDEX IF NOT EXISTS "orders_order_number_idx" ON "orders"("order_number");

-- Order Item Model
CREATE TABLE IF NOT EXISTS "order_items" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "variant_id" INTEGER,
  "quantity" INTEGER NOT NULL,
  "price" DECIMAL(10, 2) NOT NULL,
  "total" DECIMAL(10, 2) NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
  CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
  CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX IF NOT EXISTS "order_items_product_id_idx" ON "order_items"("product_id");
