// routes/verify.js
// Two-step account verification routes — PART OF REGISTRATION.
//
// These routes are NOT protected by authGuard because during the registration
// workflow the user hasn't been created or authenticated yet. Instead, every
// handler inside verifyController.js checks req.session.pendingRegistration
// (written by authController.handleRegister after form validation). If that
// session object is missing or expired, requests are bounced back to
// /register with a flash message.
//
// The OTP send/compare logic lives in controllers/verifyController.js, and
// the actual delivery of OTPs is delegated to services/email.js and
// services/sms.js (provider-agnostic wrappers, stubbed for now).

const express = require("express");
const router = express.Router();
const verifyController = require("../controllers/verifyController");
const { otpSendBlock, otpCheckBlock } = require("../middlewares/trafficLimiter");

router.get("/verify", verifyController.showVerifyPage);
router.post("/verify/email/send", otpSendBlock, verifyController.sendEmailCode);
router.post("/verify/email/check", otpCheckBlock, verifyController.checkEmailCode);
router.post("/verify/phone/send", otpSendBlock, verifyController.sendPhoneCode);
router.post("/verify/phone/check", otpCheckBlock, verifyController.checkPhoneCode);

module.exports = router;
