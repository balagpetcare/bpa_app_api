# Notification Hook Points Map (Phase 6)

Path + function + recommended createNotification() config. Recipient scope = USER (recipientUserId) unless noted.

| # | File path | Function | type | priority | actionUrl | dedupeKey |
|---|-----------|----------|------|----------|-----------|-----------|
| 1 | src/api/v1/services/branchAccessNotification.service.ts | notifyManagerOfAccessRequest | STAFF_BRANCH_ACCESS_REQUEST | P1 | /owner/staff-access | access_request:${branchId}:${staffUserId} |
| 2 | src/api/v1/services/branchAccessNotification.service.ts | notifyOwnerOfAccessRequest | STAFF_BRANCH_ACCESS_REQUEST | P1 | /owner/access/requests (meta.permissionId) | access_request_owner:${branchId}:${staffUserId} |
| 3 | src/api/v1/services/branchAccessNotification.service.ts | notifyStaffOfApproval | STAFF_BRANCH_ACCESS_APPROVED | P1 | /staff/branches | access_approved:${permissionId} |
| 4 | src/api/v1/modules/owner/owner.controller.ts | rejectBranchAccessOwner | SYSTEM (meta.action: branch_access_rejected) | P1 | /staff/branches | access_rejected:${permissionId} |
| 5 | src/api/v1/services/branchAccessNotification.service.ts | notifyStaffOfRevocation | STAFF_BRANCH_ACCESS_REVOKED | P1 | /staff/branches | access_revoked:${permissionId} |
| 6 | src/api/v1/services/branchAccessNotification.service.ts | notifyStaffOfExpiration | STAFF_BRANCH_ACCESS_EXPIRED | P2 | /staff/branches | access_expiring:${userId}:${branchId} |
| 7 | src/api/v1/modules/transfers/transfers.service.ts | sendTransfer (after status IN_TRANSIT) | SYSTEM (meta.action: transfer_sent) | P1 | /owner/transfers/:id | transfer_sent:${transferId} |
| 8 | src/api/v1/modules/transfers/transfers.service.ts | receiveTransfer (status DISPUTED/COMPLETED) | SYSTEM (meta.action: transfer_received / transfer_discrepancy) | P1 | /owner/transfers/:id | transfer_received:${transferId} |
| 9 | src/api/v1/modules/returns/returns.service.ts | approveReturnRequest | SYSTEM (meta.action: return_approved) | P1 | /shop/returns/:id | return_approved:${returnRequestId} |
| 10 | src/api/v1/modules/admin_verification_cases/admin_verification_cases.controller.ts | decideCase | VERIFICATION_CASE_APPROVED / VERIFICATION_CASE_REJECTED | P1 | /owner/verification (meta.caseId) | verification_case:${caseId} |

Recipients: (1)(2) managers/owner; (3)(4)(5)(6) staff userId; (7)(8) from/to location org owner; (9) return requester; (10) resolveRecipientUserId(entityType, entityId).

Do not modify /me/notifications or /owner/notifications routes. Only add or replace with createNotification() in services/controllers.
