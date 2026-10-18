const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');
const { registerBlock, loginBlock } = require('../middlewares/trafficLimiter');
const { KENYA_COUNTIES } = require('../utils/kenyaCounties');

// Public Auth Endpoints
router.post('/register', registerBlock, authController.register);
router.post('/login', loginBlock, authController.login);

// Reference data endpoint
router.get('/counties', (req, res) => {
  res.json({ success: true, counties: KENYA_COUNTIES });
});

// Authenticated Onboarding Endpoints
router.post('/send-code', authenticate, authController.sendCode);
router.post('/verify-code', authenticate, authController.verifyCode);
router.post('/verify-email', authenticate, authController.verifyEmail);
router.post('/verify-phone', authenticate, authController.verifyPhone);
router.post('/resend-code', authenticate, authController.resendCode);
router.get('/status', authenticate, authController.getStatus);

module.exports = router;
