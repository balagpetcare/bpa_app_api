-- CreateTable
CREATE TABLE IF NOT EXISTS "super_admin_whitelist" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT,
  "phone" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex (unique)
CREATE UNIQUE INDEX IF NOT EXISTS "super_admin_whitelist_email_key" ON "super_admin_whitelist"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "super_admin_whitelist_phone_key" ON "super_admin_whitelist"("phone");
