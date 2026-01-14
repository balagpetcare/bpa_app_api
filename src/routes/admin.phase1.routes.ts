import { Router } from "express";
import { requirePerm } from "../modules/rbac/rbac.middleware";

import * as branchCtrl from "../modules/branch/branch.controller";
import * as permCtrl from "../modules/permissions/permission.controller";
import * as roleCtrl from "../modules/roles/role.controller";
import * as staffCtrl from "../modules/staff/staff.controller";

export const adminPhase1Router = Router();

// Branches
adminPhase1Router.get("/admin/branches", requirePerm("branch.read"), branchCtrl.list);
adminPhase1Router.post("/admin/branches", requirePerm("branch.write"), branchCtrl.create);
adminPhase1Router.patch("/admin/branches/:id", requirePerm("branch.write"), branchCtrl.update);

// Permissions
adminPhase1Router.get("/admin/permissions", requirePerm("role.read"), permCtrl.list);

// Roles
adminPhase1Router.get("/admin/roles", requirePerm("role.read"), roleCtrl.list);
adminPhase1Router.post("/admin/roles", requirePerm("role.write"), roleCtrl.create);
adminPhase1Router.patch("/admin/roles/:id", requirePerm("role.write"), roleCtrl.update);
adminPhase1Router.post("/admin/roles/:id/permissions", requirePerm("role.write"), roleCtrl.replacePermissions);

// Staff
adminPhase1Router.get("/admin/staff", requirePerm("staff.read"), staffCtrl.list);
adminPhase1Router.post("/admin/staff", requirePerm("staff.write"), staffCtrl.create);
adminPhase1Router.post("/admin/staff/:id/roles", requirePerm("staff.write"), staffCtrl.assignRole);
adminPhase1Router.post("/admin/staff/:id/branches", requirePerm("staff.write"), staffCtrl.assignBranch);