// routes/logauth.js
// Page routes for login and registration views.

const express = require("express");
const router = express.Router();

// GET /register — show the multi-step registration form
router.get("/register", (req, res) => {
  res.render("register", { title: "Create your Chama account" });
});

// GET /login — show standalone login page
router.get("/login", (req, res) => {
  res.render("login", { title: "Personal Account Login" });
});

module.exports = router;
