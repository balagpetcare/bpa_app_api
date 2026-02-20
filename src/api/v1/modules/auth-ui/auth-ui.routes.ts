/**
 * Central Auth UI Routes
 * 
 * Serves HTML pages for centralized authentication.
 * These pages redirect back to the calling panel after successful auth.
 * 
 * Routes:
 * - GET /auth/login   - Login page
 * - GET /auth/register - Register page
 */

const express = require("express");
const controller = require("./auth-ui.controller");

const router = express.Router();

// Login page
router.get("/login", controller.loginPage);

// Register page
router.get("/register", controller.registerPage);

module.exports = router;

export {};
