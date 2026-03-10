-- Add visitId to orders for clinic billing link
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "visitId" INTEGER;

CREATE INDEX IF NOT EXISTS "orders_visitId_idx" ON "orders"("visitId");

ALTER TABLE "orders" ADD CONSTRAINT "orders_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
