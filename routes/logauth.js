// routes/logauth.js
// Session-based auth routes (login / register / logout).

const express = require("express");
const router = express.Router();
const authController = require("../controllers/logauthController");
const {
  loginBlock,
  registerBlock,
  forgotPinSendBlock,
  forgotPinVerifyBlock,
} = require("../middlewares/trafficLimiter");

// Login form + submit (protected against brute-force & CPU flooding)
console.log("[routes/logauth] Registering login routes (GET/POST /login)");
router.get("/login", authController.showLogin);
router.post("/login", loginBlock, authController.handleLogin);

// Forgot PIN verification workflow (protected against SMS flood & code brute-force)
console.log("[routes/logauth] Registering forgot-pin routes (/forgot-pin/send, /forgot-pin/verify)");
router.post("/forgot-pin/send", forgotPinSendBlock, authController.sendForgotPinCode);
router.post("/forgot-pin/verify", forgotPinVerifyBlock, authController.verifyForgotPinCode);

// Register form + submit (protected against account-creation spam)
console.log("[routes/logauth] Registering register routes (GET/POST /register)");
router.get("/register", authController.showRegister);
router.post("/register", registerBlock, authController.handleRegister);

// Logout (destroys session)
console.log("[routes/logauth] Registering logout route (GET /logout)");
router.get("/logout", authController.handleLogout);

module.exports = router;
