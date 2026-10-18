// routes/verify.js
// Verification page routes.

const express = require("express");
const router = express.Router();

router.get("/verify", (req, res) => {
  res.render("verify", { title: "Verify your Account" });
});

module.exports = router;
