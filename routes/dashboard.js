// routes/dashboard.js
// Protected routes — an active session is required via authGuard.

const express = require("express");
const router = express.Router();
const authGuard = require("../middlewares/authGuard");
const dashboardController = require("../controllers/dashboardController");

// GET /dashboard — main logged-in page.
router.get("/dashboard", authGuard, dashboardController.showDashboard);

module.exports = router;
