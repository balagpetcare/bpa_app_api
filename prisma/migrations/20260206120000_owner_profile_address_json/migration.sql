-- Add addressJson to owner_profiles for unified location (country/state/city/postal/addressLine/lat/lng)
-- Does NOT remove divisionId/districtId/upazilaId/areaId (backward compat)
ALTER TABLE "owner_profiles" ADD COLUMN IF NOT EXISTS "addressJson" JSONB;
