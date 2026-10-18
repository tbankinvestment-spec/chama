// tests/testViewer.js
// Placeholder route for the test viewer.

const express = require("express");
const router = express.Router();

router.get("/tests", (req, res) => {
  if (req.xhr || req.headers.accept?.includes("application/json")) {
    return res.json({
      status: "active",
      testSuite: "Login & Input Security Suite",
      coverage: [
        "Prompt Injection & LLM jailbreak sanitization",
        "NoSQL object tampering ($gt, $ne)",
        "ChatML & Special delimiter injection",
        "Mass Assignment defense",
        "Traffic limiter flood & brute-force defense",
        "JWT signature & algorithm verification"
      ],
      runCommand: "npm test"
    });
  }
  return res.render("tests", {
    title: "Security & Injection Test Console",
  });
});

module.exports = router;
