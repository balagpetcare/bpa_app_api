-- Campaign Config Backfill Script
-- Creates default CampaignConfig records for all existing campaigns without configs
-- Safe to run multiple times (uses ON CONFLICT DO NOTHING)

-- Insert default config records for all campaigns that don't have one
INSERT INTO campaign_configs (
    "campaignId",
    version,
    "bookingEnabled",
    "walkInAllowed", 
    "approvalRequired",
    "slotRequired",
    "autoCloseWhenFull",
    "maxCapacity",
    "maxCatsPerBooking",
    "showRemainingSlots",
    "lateBookingAllowed",
    "onlinePaymentEnabled",
    "payAtVenueEnabled",
    "metadataJson",
    "createdAt",
    "updatedAt"
)
SELECT 
    c.id as "campaignId",
    1 as version,
    true as "bookingEnabled",
    COALESCE(c."allowWalkIns", true) as "walkInAllowed",
    false as "approvalRequired", 
    true as "slotRequired",
    true as "autoCloseWhenFull",
    0 as "maxCapacity",
    COALESCE(c."maxPetsPerBooking", 5) as "maxCatsPerBooking",
    true as "showRemainingSlots",
    false as "lateBookingAllowed",
    CASE 
        WHEN c."pricingType" = 'FREE' THEN false
        ELSE false  -- Conservative: start with online payments disabled
    END as "onlinePaymentEnabled",
    CASE 
        WHEN c."pricingType" = 'FREE' THEN false
        ELSE true   -- Enable venue payment for paid campaigns
    END as "payAtVenueEnabled",
    jsonb_build_object(
        'backfilled', true,
        'backfillDate', NOW()::text,
        'reason', 'Default config created during system initialization'
    ) as "metadataJson",
    NOW() as "createdAt",
    NOW() as "updatedAt"
FROM campaigns c
WHERE NOT EXISTS (
    SELECT 1 FROM campaign_configs cc WHERE cc."campaignId" = c.id
)
ON CONFLICT ("campaignId") DO NOTHING;

-- Summary queries for reporting
SELECT 
    'SUMMARY' as type,
    COUNT(*) as total_campaigns,
    (SELECT COUNT(*) FROM campaign_configs) as campaigns_with_config,
    (SELECT COUNT(*) FROM campaigns WHERE NOT EXISTS (SELECT 1 FROM campaign_configs cc WHERE cc."campaignId" = campaigns.id)) as missing_configs;

-- Detailed verification
SELECT 
    'VERIFICATION' as type,
    c.id as campaign_id,
    c.name as campaign_name,
    c."pricingType" as pricing_type,
    CASE WHEN cc.id IS NOT NULL THEN 'HAS_CONFIG' ELSE 'MISSING_CONFIG' END as config_status
FROM campaigns c
LEFT JOIN campaign_configs cc ON cc."campaignId" = c.id
ORDER BY c.id
LIMIT 10;