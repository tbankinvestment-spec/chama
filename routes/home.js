// routes/home.js
// Public, unauthenticated routes related to the marketing / landing side.

const express = require("express");
const router = express.Router();
const homeController = require("../controllers/homeController");

// GET / — landing page.
router.get("/", homeController.showHome);

module.exports = router;
