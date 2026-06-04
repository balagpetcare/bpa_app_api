-- warehouse_racks.zoneId -> warehouse_zones.id (deferred from 20260402140000; warehouse_zones is created in 20260430140000).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouse_zones')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'warehouse_racks')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_racks_zoneId_fkey') THEN
    ALTER TABLE "warehouse_racks" ADD CONSTRAINT "warehouse_racks_zoneId_fkey"
      FOREIGN KEY ("zoneId") REFERENCES "warehouse_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
