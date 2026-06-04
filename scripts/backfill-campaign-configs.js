/**
 * Backfill Default Campaign Config Records
 * 
 * Creates default CampaignConfig records for all existing campaigns
 * that don't already have a config record.
 * 
 * Usage: node scripts/backfill-campaign-configs.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Starting Campaign Config Backfill...\n');

  try {
    // 1. Find all campaigns without config records
    const campaignsWithoutConfig = await prisma.campaign.findMany({
      where: {
        config: null,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        pricingType: true,
        allowWalkIns: true,
        maxPetsPerBooking: true,
        createdAt: true,
      },
    });

    console.log(`📊 Found ${campaignsWithoutConfig.length} campaigns without config records\n`);

    if (campaignsWithoutConfig.length === 0) {
      console.log('✅ All campaigns already have config records. Nothing to backfill.');
      return;
    }

    // 2. Create default config records
    let successCount = 0;
    let errorCount = 0;

    for (const campaign of campaignsWithoutConfig) {
      try {
        // Determine safe defaults based on existing campaign settings
        const defaultConfig = {
          campaignId: campaign.id,
          version: 1,
          // Booking & Capacity defaults
          bookingEnabled: true,
          walkInAllowed: campaign.allowWalkIns ?? true,
          approvalRequired: false,
          slotRequired: true,
          autoCloseWhenFull: true,
          maxCapacity: 0, // 0 = unlimited
          maxCatsPerBooking: campaign.maxPetsPerBooking ?? 5,
          showRemainingSlots: true,
          lateBookingAllowed: false,
          // Payment defaults (conservative - both disabled for safety)
          onlinePaymentEnabled: campaign.pricingType === 'FREE' ? false : false, // Start conservative
          payAtVenueEnabled: campaign.pricingType === 'FREE' ? false : true,    // Enable venue payment for paid campaigns
          // Metadata
          metadataJson: {
            backfilled: true,
            backfillDate: new Date().toISOString(),
            reason: 'Default config created during campaign config system initialization',
          },
        };

        await prisma.campaignConfig.create({
          data: defaultConfig,
        });

        console.log(`✓ Created config for campaign "${campaign.name}" (ID: ${campaign.id})`);
        successCount++;

      } catch (error) {
        console.error(`✗ Failed to create config for campaign "${campaign.name}" (ID: ${campaign.id}):`, error.message);
        errorCount++;
      }
    }

    // 3. Summary
    console.log(`\n📈 Backfill Summary:`);
    console.log(`   ✅ Success: ${successCount} config records created`);
    if (errorCount > 0) {
      console.log(`   ❌ Errors: ${errorCount} campaigns failed`);
    }
    console.log(`\n🎉 Campaign Config Backfill completed!`);

    // 4. Verification
    const totalCampaigns = await prisma.campaign.count();
    const campaignsWithConfig = await prisma.campaign.count({
      where: {
        config: {
          isNot: null,
        },
      },
    });

    console.log(`\n🔍 Verification:`);
    console.log(`   Total campaigns: ${totalCampaigns}`);
    console.log(`   Campaigns with config: ${campaignsWithConfig}`);
    console.log(`   Coverage: ${Math.round((campaignsWithConfig / totalCampaigns) * 100)}%`);

    if (campaignsWithConfig === totalCampaigns) {
      console.log(`   ✅ All campaigns now have config records!`);
    } else {
      console.log(`   ⚠️  ${totalCampaigns - campaignsWithConfig} campaigns still missing config`);
    }

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { main };