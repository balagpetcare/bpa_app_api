-- Idempotent: add auth_batches print columns only if missing (fixes "column does not exist" when migration was not applied on this DB)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_batches' AND column_name = 'printedAt') THEN
    ALTER TABLE "auth_batches" ADD COLUMN "printedAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_batches' AND column_name = 'printedByUserId') THEN
    ALTER TABLE "auth_batches" ADD COLUMN "printedByUserId" INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_batches' AND column_name = 'printCount') THEN
    ALTER TABLE "auth_batches" ADD COLUMN "printCount" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Add FK only if it does not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auth_batches_printedByUserId_fkey'
  ) THEN
    ALTER TABLE "auth_batches" ADD CONSTRAINT "auth_batches_printedByUserId_fkey"
      FOREIGN KEY ("printedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
