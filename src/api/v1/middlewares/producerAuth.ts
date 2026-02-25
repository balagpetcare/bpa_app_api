const prisma = require("../../../infrastructure/db/prismaClient");

/**
 * Producer authentication middleware
 * Checks if user has required producer permissions
 */
export const requireProducerPermission = (requiredPermissions: string[]) => {
  return async (req: any, res: any, next: any) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const requiresVerified = requiredPermissions.some((perm) =>
        perm.startsWith("producer.products") ||
        perm.startsWith("producer.batches") ||
        perm.startsWith("producer.codes") ||
        perm.startsWith("producer.verification") ||
        perm.startsWith("producer.analytics")
      );

      // Check if user owns a producer org
      const producerOrg = await prisma.producerOrg.findFirst({
        where: { ownerUserId: userId },
        select: { id: true, status: true, name: true },
      });

      // If user owns the producer org, grant all permissions
      if (producerOrg) {
        if (producerOrg.status === "SUSPENDED") {
          return res.status(403).json({
            success: false,
            message: "Producer organization is suspended",
          });
        }
        if (requiresVerified && producerOrg.status !== "VERIFIED") {
          return res.status(403).json({
            success: false,
            message: "Producer organization is not verified yet",
          });
        }
        req.producerOrgId = producerOrg.id;
        req.isProducerOwner = true;
        return next();
      }

      // Check if user is a staff member with required permissions
      const staffMembership = await prisma.producerOrgStaff.findFirst({
        where: { userId },
        include: {
          role: {
            include: {
              rolePermissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
          producerOrg: {
            select: { id: true, status: true },
          },
        },
      });

      if (!staffMembership) {
        return res.status(403).json({
          success: false,
          message: "You are not associated with any producer organization",
        });
      }

      if (staffMembership.status !== "ACTIVE") {
        return res.status(403).json({
          success: false,
          message: "Producer staff access is not active",
        });
      }

      // Check if producer org is active
      if (staffMembership.producerOrg.status === "SUSPENDED") {
        return res.status(403).json({
          success: false,
          message: "Producer organization is suspended",
        });
      }
      if (requiresVerified && staffMembership.producerOrg.status !== "VERIFIED") {
        return res.status(403).json({
          success: false,
          message: "Producer organization is not verified yet",
        });
      }

      // Get user's permissions
      const userPermissions = staffMembership.role.rolePermissions.map(
        (rp: any) => rp.permission.key
      );

      // Check if user has all required permissions
      const hasAllPermissions = requiredPermissions.every((perm) =>
        userPermissions.includes(perm)
      );

      if (!hasAllPermissions) {
        return res.status(403).json({
          success: false,
          message: "Insufficient permissions",
          required: requiredPermissions,
          userPermissions,
        });
      }

      // Attach producer org info to request
      req.producerOrgId = staffMembership.producerOrgId;
      req.isProducerOwner = false;
      req.producerStaffId = staffMembership.id;
      req.producerPermissions = userPermissions;

      next();
    } catch (error) {
      console.error("Producer auth middleware error:", error);
      return res.status(500).json({
        success: false,
        message: "Authorization check failed",
      });
    }
  };
};

/**
 * Middleware to check if user is producer owner
 */
export const requireProducerOwner = async (req: any, res: any, next: any) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const producerOrg = await prisma.producerOrg.findFirst({
      where: { ownerUserId: userId },
      select: { id: true, status: true },
    });

    if (!producerOrg) {
      return res.status(403).json({
        success: false,
        message: "Only producer owners can perform this action",
      });
    }

    if (producerOrg.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        message: "Producer organization is suspended",
      });
    }

    req.producerOrgId = producerOrg.id;
    req.isProducerOwner = true;

    next();
  } catch (error) {
    console.error("Producer owner check error:", error);
    return res.status(500).json({
      success: false,
      message: "Authorization check failed",
    });
  }
};

module.exports = {
  requireProducerPermission,
  requireProducerOwner,
};
