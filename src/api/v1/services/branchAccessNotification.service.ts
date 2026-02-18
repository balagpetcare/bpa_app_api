/**
 * Branch Access Notification Service
 * Handles email notifications for branch access requests, approvals, revocations, and expirations
 */

const prisma = require("../../../infrastructure/db/prismaClient").default;
const { sendMail, isSmtpEnabled } = require("../../../utils/smtpMailer");
const { createNotification } = require("./notification.service");
const fs = require("fs");
const path = require("path");

/**
 * Load email template
 */
function loadEmailTemplate(templateName: string, variables: Record<string, string> = {}) {
  const templatePath = path.join(
    __dirname,
    "../../../utils/emailTemplates",
    `${templateName}.html`
  );

  let html = "";
  try {
    if (fs.existsSync(templatePath)) {
      html = fs.readFileSync(templatePath, "utf-8");
    } else {
      // Fallback template
      html = getFallbackTemplate(templateName, variables);
    }
  } catch (error) {
    console.error(`[NOTIFICATION] Failed to load template ${templateName}:`, error);
    html = getFallbackTemplate(templateName, variables);
  }

  // Replace variables
  Object.keys(variables).forEach((key) => {
    const regex = new RegExp(`{{${key}}}`, "g");
    html = html.replace(regex, variables[key] || "");
  });

  return html;
}

/**
 * Get fallback template if file doesn't exist
 */
function getFallbackTemplate(templateName: string, variables: Record<string, string>) {
  const staffName = variables.staffName || "Staff Member";
  const branchName = variables.branchName || "Branch";
  const orgName = variables.orgName || "Organization";
  const expiresAt = variables.expiresAt || "";

  switch (templateName) {
    case "branchAccessRequestConfirmation":
      return `
        <h2>Access Request Submitted</h2>
        <p>Hi ${variables.staffName || "Staff"},</p>
        <p>Your request to access <strong>${variables.branchName || "Branch"}</strong> (${variables.orgName || "Organization"}) has been submitted and is pending approval.</p>
        <p>You will be notified by email once an owner or manager approves or rejects your request.</p>
      `;
    case "branchAccessRequest":
      return `
        <h2>Branch Access Request</h2>
        <p>${staffName} has requested access to ${branchName} (${orgName}).</p>
        <p>Please review and approve or reject this request in your dashboard.</p>
      `;
    case "branchAccessApproved":
      return `
        <h2>Branch Access Approved</h2>
        <p>Your access request to ${branchName} (${orgName}) has been approved.</p>
        ${expiresAt ? `<p>This access will expire on ${expiresAt}.</p>` : "<p>This access has no expiration date.</p>"}
      `;
    case "branchAccessRevoked":
      return `
        <h2>Branch Access Revoked</h2>
        <p>Your access to ${branchName} (${orgName}) has been revoked.</p>
        <p>You will no longer be able to access this branch.</p>
      `;
    case "branchAccessExpiring":
      return `
        <h2>Branch Access Expiring Soon</h2>
        <p>Your access to ${branchName} (${orgName}) will expire on ${expiresAt}.</p>
        <p>Please contact your branch manager if you need to extend your access.</p>
      `;
    default:
      return `<p>${variables.message || "Notification"}</p>`;
  }
}

/**
 * Send confirmation email to staff when they submit an access request
 */
export async function notifyStaffOfRequestSubmitted(staffUserId: number, branchId: number) {
  try {
    const staff = await prisma.user.findUnique({
      where: { id: staffUserId },
      include: {
        profile: { select: { displayName: true } },
        auth: { select: { email: true } },
      },
    });
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: { org: { select: { name: true } } },
    });
    if (!staff?.auth?.email || !branch) return { success: true };

    const staffName = staff.profile?.displayName || staff.auth?.email || "Staff";
    const branchName = branch.name;
    const orgName = branch.org?.name || "Organization";

    const html = loadEmailTemplate("branchAccessRequestConfirmation", {
      staffName,
      branchName,
      orgName,
    });

    if (isSmtpEnabled()) {
      await sendMail({
        to: staff.auth.email,
        subject: `Access Request Submitted: ${branchName}`,
        html,
      });
    } else {
      console.log("[NOTIFICATION] Confirmation email would be sent to staff:", staff.auth.email);
    }
    return { success: true };
  } catch (error) {
    console.error("[NOTIFICATION] Error sending staff confirmation:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Notify manager of access request
 */
export async function notifyManagerOfAccessRequest(branchId: number, staffUserId: number) {
  try {
    // Get branch and manager info
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        org: {
          select: {
            id: true,
            name: true,
          },
        },
        members: {
          where: {
            role: "BRANCH_MANAGER",
            status: "ACTIVE",
          },
          include: {
            user: {
              include: {
                auth: {
                  select: {
                    email: true,
                  },
                },
                profile: {
                  select: {
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!branch) {
      console.error(`[NOTIFICATION] Branch ${branchId} not found`);
      return { success: false, error: "Branch not found" };
    }

    // Get staff info
    const staff = await prisma.user.findUnique({
      where: { id: staffUserId },
      include: {
        profile: {
          select: {
            displayName: true,
            username: true,
          },
        },
        auth: {
          select: {
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!staff) {
      console.error(`[NOTIFICATION] Staff user ${staffUserId} not found`);
      return { success: false, error: "Staff not found" };
    }

    const staffName = staff.profile?.displayName || staff.auth?.email || "Staff Member";
    const branchName = branch.name;
    const orgName = branch.org.name;

    // Create in-app notification for each manager (Phase 6 hook point 1)
    for (const member of branch.members) {
      await createNotification({
        userId: member.userId,
        type: "STAFF_BRANCH_ACCESS_REQUEST",
        title: "New Branch Access Request",
        message: `${staffName} has requested access to ${branchName}`,
        meta: { branchId, staffUserId, branchName, orgName, staffName },
        priority: "P1",
        actionUrl: "/owner/staff-access",
        dedupeKey: `access_request:${branchId}:${staffUserId}:${member.userId}`,
        orgId: branch.org.id,
        branchId,
        severity: "info",
        source: "branch_access",
      }).catch((err) => console.error("[NOTIFICATION] createNotification manager:", err?.message));
    }

    // Send email to managers
    const emailPromises = branch.members
      .filter((member) => member.user?.auth?.email)
      .map(async (member) => {
        const managerEmail = member.user.auth.email;
        if (!managerEmail) return;

        const ownerWebUrl = process.env.OWNER_WEB_URL || process.env.PUBLIC_WEB_URL || "http://localhost:3104";
        const reviewUrl = `${ownerWebUrl.replace(/\/+$/, "")}/owner/staff-access`;
        const html = loadEmailTemplate("branchAccessRequest", {
          staffName,
          branchName,
          orgName,
          managerName: member.user.profile?.displayName || "Manager",
          reviewUrl,
        });

        if (isSmtpEnabled()) {
          try {
            await sendMail({
              to: managerEmail,
              subject: `Branch Access Request: ${staffName} - ${branchName}`,
              html,
            });
          } catch (error) {
            console.error(`[NOTIFICATION] Failed to send email to ${managerEmail}:`, error);
          }
        } else {
          console.log(`[NOTIFICATION] Email would be sent to ${managerEmail}: Branch access request`);
        }
      });

    await Promise.all(emailPromises);

    return { success: true };
  } catch (error) {
    console.error("[NOTIFICATION] Error notifying manager:", error);
    return { success: false, error: String(error) };
  }
}

export async function notifyOwnerOfAccessRequest(branchId: number, staffUserId: number, permissionId: number) {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        name: true,
        org: { select: { id: true, name: true, ownerUserId: true } },
      },
    });
    if (!branch?.org?.ownerUserId) return { success: true };

    const staff = await prisma.user.findUnique({
      where: { id: staffUserId },
      select: {
        id: true,
        profile: { select: { displayName: true } },
        auth: { select: { email: true, phone: true } },
      },
    });

    const owner = await prisma.user.findUnique({
      where: { id: branch.org.ownerUserId },
      select: {
        auth: { select: { email: true } },
      },
    });

    const perm = await prisma.branchAccessPermission.findUnique({
      where: { id: permissionId },
      select: { role: true },
    }).catch(() => null);
    const roleRequested = perm?.role || "";

    const staffName = staff?.profile?.displayName || staff?.auth?.email || staff?.auth?.phone || "Staff Member";
    const requesterEmail = staff?.auth?.email || staff?.auth?.phone || "";

    const meta = {
      branchId,
      branchName: branch.name,
      staffUserId,
      staffName,
      requesterEmail,
      role: roleRequested,
      permissionId,
    };

    await createNotification({
      userId: branch.org.ownerUserId,
      type: "STAFF_BRANCH_ACCESS_REQUEST",
      title: "Branch access approval needed",
      message: `${staffName} has requested access to ${branch.name}`,
      meta,
      priority: "P1",
      actionUrl: "/owner/access/requests",
      dedupeKey: `access_request_owner:${branchId}:${staffUserId}`,
      orgId: branch.org.id,
      branchId,
      severity: "info",
      source: "branch_access",
    }).catch((err) => console.error("[NOTIFICATION] createNotification owner:", err?.message));

    // Send email to Owner
    const ownerEmail = owner?.auth?.email;
    if (ownerEmail) {
      const ownerWebUrl = process.env.OWNER_WEB_URL || process.env.PUBLIC_WEB_URL || "http://localhost:3104";
      const reviewUrl = `${ownerWebUrl.replace(/\/+$/, "")}/owner/access/requests`;

      const html = loadEmailTemplate("branchAccessRequest", {
        staffName,
        branchName: branch.name,
        orgName: branch.org?.name || "Organization",
        managerName: "Owner",
        reviewUrl,
        requesterEmail,
        roleRequested: roleRequested || "—",
      });

      if (isSmtpEnabled()) {
        try {
          await sendMail({
            to: ownerEmail,
            subject: `Branch Access Request: ${staffName} - ${branch.name}`,
            html,
          });
        } catch (error) {
          console.error(`[NOTIFICATION] Failed to send email to owner ${ownerEmail}:`, error);
        }
      } else {
        console.warn("[NOTIFICATION] SMTP not configured; owner email not sent. Set SMTP_HOST, SMTP_USER, SMTP_PASS.");
      }
    }

    return { success: true };
  } catch (error) {
    console.error("[NOTIFICATION] Error notifying owner:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Notify staff of approval
 */
export async function notifyStaffOfApproval(userId: number, branchId: number) {
  try {
    const permission = await prisma.branchAccessPermission.findUnique({
      where: {
        branchId_userId: {
          branchId,
          userId,
        },
      },
      include: {
        branch: {
          include: {
            org: {
              select: {
                name: true,
              },
            },
          },
        },
        user: {
          include: {
            auth: {
              select: {
                email: true,
              },
            },
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!permission) {
      return { success: false, error: "Permission not found" };
    }

    const staffName = permission.user.profile?.displayName || permission.user.auth?.email || "Staff";
    const branchName = permission.branch.name;
    const orgName = permission.branch.org.name;
    const expiresAt = permission.expiresAt
      ? new Date(permission.expiresAt).toLocaleDateString()
      : "";

    // Create in-app notification (Phase 6 hook point 3)
    await createNotification({
      userId,
      type: "STAFF_BRANCH_ACCESS_APPROVED",
      title: "Branch Access Approved",
      message: `Your access to ${branchName} has been approved`,
      meta: { branchId, branchName, orgName, expiresAt: permission.expiresAt },
      priority: "P1",
      actionUrl: "/staff/branch",
      dedupeKey: `access_approved:${permission.id}`,
      orgId: permission.branch.orgId,
      branchId,
      severity: "success",
      source: "branch_access",
    }).catch((err) => console.error("[NOTIFICATION] createNotification approval:", err?.message));

    // Send email
    const staffEmail = permission.user.auth?.email;
    if (staffEmail) {
      // Build expiresAt section
      const expiresAtSection = expiresAt
        ? `<p><strong>Important:</strong> This access will expire on <strong>${expiresAt}</strong>.</p><p>Please contact your branch manager if you need to extend your access period.</p>`
        : "<p>You now have ongoing access to this branch. You can start working immediately.</p>";

      const html = loadEmailTemplate("branchAccessApproved", {
        staffName,
        branchName,
        orgName,
        expiresAt,
        expiresAtSection,
      });

      if (isSmtpEnabled()) {
        try {
          await sendMail({
            to: staffEmail,
            subject: `Access Approved: ${branchName}`,
            html,
          });
        } catch (error) {
          console.error(`[NOTIFICATION] Failed to send email to ${staffEmail}:`, error);
        }
      } else {
        console.log(`[NOTIFICATION] Email would be sent to ${staffEmail}: Access approved`);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("[NOTIFICATION] Error notifying staff of approval:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Notify staff of revocation
 */
export async function notifyStaffOfRevocation(userId: number, branchId: number) {
  try {
    const permission = await prisma.branchAccessPermission.findUnique({
      where: {
        branchId_userId: {
          branchId,
          userId,
        },
      },
      include: {
        branch: {
          include: {
            org: {
              select: {
                name: true,
              },
            },
          },
        },
        user: {
          include: {
            auth: {
              select: {
                email: true,
              },
            },
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!permission) {
      return { success: false, error: "Permission not found" };
    }

    const staffName = permission.user.profile?.displayName || permission.user.auth?.email || "Staff";
    const branchName = permission.branch.name;
    const orgName = permission.branch.org.name;

    // Create in-app notification
    await prisma.notification.create({
      data: {
        userId,
        type: "STAFF_BRANCH_ACCESS_REVOKED",
        title: "Branch Access Revoked",
        message: `Your access to ${branchName} has been revoked`,
        meta: {
          branchId,
          branchName,
          orgName,
        },
      },
    });

    // Send email
    const staffEmail = permission.user.auth?.email;
    if (staffEmail) {
      const html = loadEmailTemplate("branchAccessRevoked", {
        staffName,
        branchName,
        orgName,
      });

      if (isSmtpEnabled()) {
        try {
          await sendMail({
            to: staffEmail,
            subject: `Access Revoked: ${branchName}`,
            html,
          });
        } catch (error) {
          console.error(`[NOTIFICATION] Failed to send email to ${staffEmail}:`, error);
        }
      } else {
        console.log(`[NOTIFICATION] Email would be sent to ${staffEmail}: Access revoked`);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("[NOTIFICATION] Error notifying staff of revocation:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Notify staff of expiration (before it expires)
 */
export async function notifyStaffOfExpiration(userId: number, branchId: number, expiresAt: Date) {
  try {
    const permission = await prisma.branchAccessPermission.findUnique({
      where: {
        branchId_userId: {
          branchId,
          userId,
        },
      },
      include: {
        branch: {
          include: {
            org: {
              select: {
                name: true,
              },
            },
          },
        },
        user: {
          include: {
            auth: {
              select: {
                email: true,
              },
            },
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!permission) {
      return { success: false, error: "Permission not found" };
    }

    const staffName = permission.user.profile?.displayName || permission.user.auth?.email || "Staff";
    const branchName = permission.branch.name;
    const orgName = permission.branch.org.name;
    const expiresAtStr = new Date(expiresAt).toLocaleDateString();

    // Create in-app notification
    await prisma.notification.create({
      data: {
        userId,
        type: "STAFF_BRANCH_ACCESS_EXPIRED",
        title: "Branch Access Expiring Soon",
        message: `Your access to ${branchName} will expire on ${expiresAtStr}`,
        meta: {
          branchId,
          branchName,
          orgName,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    // Send email
    const staffEmail = permission.user.auth?.email;
    if (staffEmail) {
      const html = loadEmailTemplate("branchAccessExpiring", {
        staffName,
        branchName,
        orgName,
        expiresAt: expiresAtStr,
      });

      if (isSmtpEnabled()) {
        try {
          await sendMail({
            to: staffEmail,
            subject: `Access Expiring: ${branchName}`,
            html,
          });
        } catch (error) {
          console.error(`[NOTIFICATION] Failed to send email to ${staffEmail}:`, error);
        }
      } else {
        console.log(`[NOTIFICATION] Email would be sent to ${staffEmail}: Access expiring`);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("[NOTIFICATION] Error notifying staff of expiration:", error);
    return { success: false, error: String(error) };
  }
}
