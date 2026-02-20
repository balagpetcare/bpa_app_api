const express = require("express");
const router = express.Router();

const auth = require("../../../../middlewares/auth");
const ctrl = require("./branch_access.controller");

// Robust resolver for CJS / ESM / ts-node exports
const requestAccess =
  typeof ctrl?.requestAccess === "function" ? ctrl.requestAccess : null;
const getMyRequests =
  typeof ctrl?.getMyRequests === "function" ? ctrl.getMyRequests : null;
const getActivePermissions =
  typeof ctrl?.getActivePermissions === "function" ? ctrl.getActivePermissions : null;
const getPendingRequests =
  typeof ctrl?.getPendingRequests === "function" ? ctrl.getPendingRequests : null;
const approveAccess =
  typeof ctrl?.approveAccess === "function" ? ctrl.approveAccess : null;
const revokeAccess =
  typeof ctrl?.revokeAccess === "function" ? ctrl.revokeAccess : null;
const getBranchPermissions =
  typeof ctrl?.getBranchPermissions === "function" ? ctrl.getBranchPermissions : null;
const checkAccess =
  typeof ctrl?.checkAccess === "function" ? ctrl.checkAccess : null;

// Staff endpoints
if (requestAccess) {
  router.post("/request", auth, requestAccess);
}
if (getMyRequests) {
  router.get("/my-requests", auth, getMyRequests);
}
if (getActivePermissions) {
  router.get("/active", auth, getActivePermissions);
}
if (checkAccess) {
  router.get("/check/:branchId", auth, checkAccess);
}

// Manager endpoints
if (getPendingRequests) {
  router.get("/pending", auth, getPendingRequests);
}
if (approveAccess) {
  router.post("/:id/approve", auth, approveAccess);
}
if (revokeAccess) {
  router.post("/:id/revoke", auth, revokeAccess);
}
if (getBranchPermissions) {
  router.get("/branch/:branchId", auth, getBranchPermissions);
}

module.exports = router;

export {};
