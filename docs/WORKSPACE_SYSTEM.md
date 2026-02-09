# Workspace System

## Overview

The Workspace is an action-oriented execution environment (not a dashboard) that provides:

- **Task management** (Kanban: TODO, IN_PROGRESS, BLOCKED, DONE)
- **Alerts** (view, acknowledge, convert to task)
- **Approval queue** (approve / reject with reason)
- **Task comments** (audit-logged; owner-only private notes)

## Role-based access

| Role    | Tasks scope           | Alerts / Approvals | Can create task | Can assign any |
|---------|------------------------|--------------------|-----------------|----------------|
| Owner   | All org branches       | Full               | Yes             | Yes            |
| Manager | Own branch(es)         | Branch             | Yes             | Yes            |
| Staff   | My assigned tasks only | Read-only alerts   | No              | No             |

- **Owner**: organizations owned by user → full workspace access.
- **Manager**: branch members with role BRANCH_MANAGER or ORG_ADMIN → branch-scoped.
- **Staff**: branch access (BranchMember or BranchAccessPermission APPROVED) → only tasks where `assignedToUserId = userId`.

## API

Base path: `/api/v1/workspace`. All routes require auth; scope is enforced in the controller.

| Method | Path | Description |
|--------|------|--------------|
| GET | /workspace/me | Viewer role and capabilities |
| GET | /workspace/tasks | List tasks (filtered by role) |
| POST | /workspace/tasks | Create task |
| GET | /workspace/tasks/:id | Task detail + comments |
| PATCH | /workspace/tasks/:id | Update task |
| GET | /workspace/tasks/:id/comments | List comments |
| POST | /workspace/tasks/:id/comments | Add comment |
| GET | /workspace/alerts | List alerts |
| PATCH | /workspace/alerts/:id/acknowledge | Acknowledge alert |
| POST | /workspace/alerts/:id/convert-to-task | Create task from alert |
| GET | /workspace/approvals | List approval requests |
| POST | /workspace/approvals/:id/approve | Approve |
| POST | /workspace/approvals/:id/reject | Reject (body: `{ "reason": "..." }`) |

## Database

- **workspace_tasks**: orgId, branchId (nullable), status, type, priority, assignedToUserId, createdByUserId, deadline, linkedEntityJson, resolutionNotes, soft delete.
- **workspace_task_comments**: taskId, actorId, actorRole, body, isPrivate (owner→manager only).
- **workspace_alerts**: orgId, branchId (nullable), type, title, detailJson, acknowledgedAt, convertedToTaskId.
- **workspace_approval_requests**: orgId, branchId (nullable), type, status, payloadJson, requesterUserId, decidedByUserId, rejectReason.

Audit: all create/update/comment/approve/reject actions are written to `audit_logs` with entityType WORKSPACE_TASK, WORKSPACE_ALERT, or WORKSPACE_APPROVAL.

## Alerts from other modules

To push an alert from inventory, orders, or jobs, use the workspace service:

```ts
const { createAlert } = require("./workspace.service");
await createAlert({
  orgId,
  branchId: branchId ?? null,
  type: "LOW_STOCK",
  title: "Low stock: Product X",
  detailJson: { productId, variantId, currentQty },
});
```

## Approval queue integration

The approval list reads from `workspace_approval_requests`. To show staff invites, branch access requests, etc., create a `WorkspaceApprovalRequest` when a request is submitted (e.g. in branch access or staff invite flow), and handle approve/reject by updating both the original entity and the workspace approval row (or drive the original flow from the workspace approval action).

## Frontend

- **Owner**: `/owner/workspace` – full UI (Tasks Kanban, Alerts, Approvals, task detail + comments).
- **Staff**: `/staff/workspace` – “My Workspace” (my tasks only, update status, add work notes). Linked from staff branch sidebar as “My Workspace”.

## Migration

Run:

```bash
npx prisma migrate deploy
```

Or for dev:

```bash
npx prisma migrate dev --name workspace_system
```

Migration file: `prisma/migrations/20260209120000_workspace_system/migration.sql`.
