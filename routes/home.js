// routes/home.js
// Public routes related to marketing / landing and home redirection.

const express = require("express");
const router = express.Router();
const homeController = require("../controllers/homeController");

// GET / — landing page.
router.get("/", homeController.showHome);

// GET /home — redirects to dashboard if logged in, or renders home
router.get("/home", (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect("/dashboard");
  }
  return homeController.showHome(req, res);
});

module.exports = router;
