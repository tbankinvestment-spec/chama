// routes/dashboard.js
// Dashboard page — requires an active session.

const express = require("express");
const router = express.Router();

router.get("/dashboard", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  res.render("dashboard", {
    title: "Dashboard",
    user: req.session.user,
    layout: "dashboard",
  });
});

module.exports = router;
