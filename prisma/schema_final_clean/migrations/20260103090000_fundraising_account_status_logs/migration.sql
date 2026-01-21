-- Add fundraising_account_status_logs table (audit log)

CREATE TABLE IF NOT EXISTS "fundraising_account_status_logs" (
  "id" SERIAL PRIMARY KEY,
  "accountId" INTEGER NOT NULL,
  "fromStatus" "FundraisingAccountStatus" NOT NULL,
  "toStatus" "FundraisingAccountStatus" NOT NULL,
  "adminUserId" INTEGER,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fundraising_account_status_logs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fundraising_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fundraising_account_status_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "fundraising_account_status_logs_accountId_createdAt_idx" ON "fundraising_account_status_logs"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "fundraising_account_status_logs_adminUserId_idx" ON "fundraising_account_status_logs"("adminUserId");
