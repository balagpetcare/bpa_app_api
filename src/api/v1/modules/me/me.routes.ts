const express = require("express");
const router = express.Router();

const auth = require("../../../../middlewares/auth");
const { runProfilePhotoUpload } = require("./profilePhotoUpload.middleware");
const ctrl = require("./me.controller");

// Robust resolver for CJS / ESM / ts-node exports
const getMe =
  typeof ctrl === "function"
    ? ctrl
    : typeof ctrl?.getMe === "function"
    ? ctrl.getMe
    : typeof ctrl?.default === "function"
    ? ctrl.default
    : null;

const getNotifications =
  typeof ctrl?.getNotifications === "function"
    ? ctrl.getNotifications
    : null;

const acceptInviteFromNotification =
  typeof ctrl?.acceptInviteFromNotification === "function"
    ? ctrl.acceptInviteFromNotification
    : null;

const declineInviteFromNotification =
  typeof ctrl?.declineInviteFromNotification === "function"
    ? ctrl.declineInviteFromNotification
    : null;

const getMyInvitations =
  typeof ctrl?.getMyInvitations === "function" ? ctrl.getMyInvitations : null;
const acceptInvitationById =
  typeof ctrl?.acceptInvitationById === "function" ? ctrl.acceptInvitationById : null;
const declineInvitationById =
  typeof ctrl?.declineInvitationById === "function" ? ctrl.declineInvitationById : null;

const getPermissions =
  typeof ctrl?.getPermissions === "function"
    ? ctrl.getPermissions
    : null;
const getContexts =
  typeof ctrl?.getContexts === "function" ? ctrl.getContexts : null;
const setDefaultContext =
  typeof ctrl?.setDefaultContext === "function" ? ctrl.setDefaultContext : null;

const getLocation =
  typeof ctrl?.getLocation === "function"
    ? ctrl.getLocation
    : null;
const setLocation =
  typeof ctrl?.setLocation === "function"
    ? ctrl.setLocation
    : null;
const postLocationEvents =
  typeof ctrl?.postLocationEvents === "function"
    ? ctrl.postLocationEvents
    : null;
const postLocationManual =
  typeof ctrl?.postLocationManual === "function"
    ? ctrl.postLocationManual
    : null;

const meProfile = require("./meProfile.controller");

if (!getMe) {
  throw new Error("me.routes: getMe controller export not found");
}

router.get("/", auth, getMe);

// Enterprise profile hub (self-service, audited)
router.get("/profile", auth, meProfile.getProfile);
router.patch("/profile", auth, meProfile.patchProfile);
router.post("/profile/photo", auth, runProfilePhotoUpload, meProfile.postProfilePhoto);
router.delete("/profile/photo", auth, meProfile.deleteProfilePhoto);
router.get("/settings", auth, meProfile.getSettings);
router.patch("/settings", auth, meProfile.patchSettings);
router.get("/security", auth, meProfile.getSecurity);
router.post("/security/password", auth, meProfile.postPassword);
router.get("/capabilities", auth, meProfile.getCapabilities);
router.get("/branches", auth, meProfile.getBranches);
router.patch("/active-branch", auth, meProfile.patchActiveBranch);
router.get("/audit", auth, meProfile.getAudit);

if (getPermissions) {
  router.get("/permissions", auth, getPermissions);
}

if (getLocation) {
  router.get("/location", auth, getLocation);
}
if (setLocation) {
  router.put("/location", auth, setLocation);
}
if (postLocationEvents) {
  router.post("/location/events", auth, postLocationEvents);
}
if (postLocationManual) {
  router.post("/location/manual", auth, postLocationManual);
}

// Notification endpoints
if (getNotifications) {
  router.get("/notifications", auth, getNotifications);
}

if (acceptInviteFromNotification) {
  router.post("/notifications/:notificationId/accept-invite", auth, acceptInviteFromNotification);
}

if (declineInviteFromNotification) {
  router.post("/notifications/:notificationId/decline-invite", auth, declineInviteFromNotification);
}

if (getMyInvitations) {
  router.get("/invitations", auth, getMyInvitations);
}
if (acceptInvitationById) {
  router.post("/invitations/:id/accept", auth, acceptInvitationById);
}
if (declineInvitationById) {
  router.post("/invitations/:id/decline", auth, declineInvitationById);
}

if (getContexts) {
  router.get("/contexts", auth, getContexts);
}
if (setDefaultContext) {
  router.patch("/contexts/:id/default", auth, setDefaultContext);
}

module.exports = router;

export {};
