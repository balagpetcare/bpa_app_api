-- Forward-compatible batch metadata (object storage key, non-admin submitter type — future phases).
ALTER TABLE "medicine_import_batches" ADD COLUMN "rawStorageKey" VARCHAR(512);
ALTER TABLE "medicine_import_batches" ADD COLUMN "uploadSource" VARCHAR(32) NOT NULL DEFAULT 'ADMIN';
