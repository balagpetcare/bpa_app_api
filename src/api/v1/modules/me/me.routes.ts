const express = require("express");
const router = express.Router();

const auth = require("../../../../middlewares/auth");
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

if (!getMe) {
  throw new Error("me.routes: getMe controller export not found");
}

router.get("/", auth, getMe);

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

if (getContexts) {
  router.get("/contexts", auth, getContexts);
}
if (setDefaultContext) {
  router.patch("/contexts/:id/default", auth, setDefaultContext);
}

module.exports = router;

export {};
