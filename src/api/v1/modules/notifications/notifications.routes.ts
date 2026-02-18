const express = require("express");
const auth = require("../../../../middlewares/auth");
const ctrl = require("./notifications.controller");

const notificationsRouter = express.Router();
notificationsRouter.get("/", auth, ctrl.list);
notificationsRouter.get("/analytics", auth, ctrl.analytics);
notificationsRouter.get("/unread-count", auth, ctrl.unreadCount);
notificationsRouter.get("/count", auth, ctrl.count);
notificationsRouter.post("/mark-read", auth, ctrl.markReadBulk);
notificationsRouter.post("/read-all", auth, ctrl.readAll);
notificationsRouter.get("/settings", auth, ctrl.getSettings);
notificationsRouter.put("/settings", auth, ctrl.putSettings);
notificationsRouter.post("/test", auth, ctrl.testCreate);
notificationsRouter.post("/:id/read", auth, ctrl.markRead);

module.exports = notificationsRouter;
export {};
