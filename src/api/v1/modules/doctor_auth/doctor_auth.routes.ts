/**
 * Doctor panel auth routes: /api/v1/doctor/auth/*
 * Login/logout are public; no auth middleware.
 */
const router = require("express").Router();
const ctrl = require("./doctor_auth.controller");

router.post("/login", ctrl.login);
router.post("/logout", ctrl.logout);

module.exports = router;
