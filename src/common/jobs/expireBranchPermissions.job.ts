/**
 * Background Job: Expire Branch Permissions
 * 
 * This job runs periodically (e.g., daily) to:
 * 1. Find all APPROVED permissions that have passed their expiration date
 * 2. Update their status to EXPIRED
 * 3. Send expiration notifications to affected staff
 * 
 * Usage:
 * - Can be run via cron job
 * - Can be called manually for testing
 * - Should be scheduled to run daily (e.g., at midnight)
 */

const { expirePermissions } = require("../../api/v1/services/branchAccessPermission.service");
const { notifyStaffOfExpiration } = require("../../api/v1/services/branchAccessNotification.service");
const prisma = require("../../infrastructure/db/prismaClient").default;

/**
 * Main job function
 */
export async function runExpireBranchPermissionsJob() {
  console.log("[JOB] Starting expireBranchPermissions job...");
  const startTime = Date.now();

  try {
    // Expire permissions that have passed their expiration date
    const result = await expirePermissions();

    if (result.expired === 0) {
      console.log("[JOB] No permissions to expire.");
      return {
        success: true,
        expired: 0,
        duration: Date.now() - startTime,
      };
    }

    console.log(`[JOB] Found ${result.expired} expired permissions.`);

    // Send notifications to affected staff
    const notificationPromises = [];
    for (const permissionId of result.permissionIds || []) {
      try {
        const permission = await prisma.branchAccessPermission.findUnique({
          where: { id: permissionId },
          select: {
            userId: true,
            branchId: true,
            expiresAt: true,
          },
        });

        if (permission && permission.expiresAt) {
          // Send expiration notification (non-blocking)
          notificationPromises.push(
            notifyStaffOfExpiration(
              permission.userId,
              permission.branchId,
              new Date(permission.expiresAt)
            ).catch((err) => {
              console.error(
                `[JOB] Failed to notify user ${permission.userId} about expiration:`,
                err
              );
            })
          );
        }
      } catch (error) {
        console.error(`[JOB] Error processing permission ${permissionId}:`, error);
      }
    }

    // Wait for all notifications (with timeout)
    await Promise.allSettled(notificationPromises);

    const duration = Date.now() - startTime;
    console.log(`[JOB] Completed in ${duration}ms. Expired ${result.expired} permissions.`);

    return {
      success: true,
      expired: result.expired,
      permissionIds: result.permissionIds,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[JOB] Error in expireBranchPermissions job:", error);
    return {
      success: false,
      error: String(error),
      duration,
    };
  }
}

/**
 * Send expiration warnings (e.g., 3 days before expiration)
 * This can be run separately or as part of the main job
 */
export async function sendExpirationWarnings(daysBeforeExpiration: number = 3) {
  console.log(`[JOB] Sending expiration warnings (${daysBeforeExpiration} days before)...`);
  const startTime = Date.now();

  try {
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + daysBeforeExpiration);

    // Find permissions expiring soon
    const expiringPermissions = await prisma.branchAccessPermission.findMany({
      where: {
        status: "APPROVED",
        expiresAt: {
          gte: new Date(warningDate.getTime() - 24 * 60 * 60 * 1000), // Start of warning date
          lte: new Date(warningDate.getTime() + 24 * 60 * 60 * 1000), // End of warning date
        },
      },
      select: {
        id: true,
        userId: true,
        branchId: true,
        expiresAt: true,
      },
    });

    if (expiringPermissions.length === 0) {
      console.log("[JOB] No permissions expiring soon.");
      return {
        success: true,
        warned: 0,
        duration: Date.now() - startTime,
      };
    }

    console.log(`[JOB] Found ${expiringPermissions.length} permissions expiring soon.`);

    // Send warnings (non-blocking)
    const notificationPromises = expiringPermissions.map((permission) =>
      notifyStaffOfExpiration(
        permission.userId,
        permission.branchId,
        permission.expiresAt!
      ).catch((err) => {
        console.error(
          `[JOB] Failed to send warning to user ${permission.userId}:`,
          err
        );
      })
    );

    await Promise.allSettled(notificationPromises);

    const duration = Date.now() - startTime;
    console.log(
      `[JOB] Sent ${expiringPermissions.length} expiration warnings in ${duration}ms.`
    );

    return {
      success: true,
      warned: expiringPermissions.length,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[JOB] Error sending expiration warnings:", error);
    return {
      success: false,
      error: String(error),
      duration,
    };
  }
}

// If run directly (for testing)
if (require.main === module) {
  runExpireBranchPermissionsJob()
    .then((result) => {
      console.log("[JOB] Result:", result);
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("[JOB] Fatal error:", error);
      process.exit(1);
    });
}
