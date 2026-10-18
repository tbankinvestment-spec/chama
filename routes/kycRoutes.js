const express = require('express');
const router = express.Router();
const kycController = require('../controllers/kycController');
const { authenticate } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

// Step 7: Passport Photo Upload (single image)
router.post(
  '/passport-photo',
  authenticate,
  upload.single('passportPhoto'),
  kycController.uploadPassportPhoto
);

// Step 8: National ID Upload (Front and Back)
router.post(
  '/national-id',
  authenticate,
  upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
  ]),
  kycController.uploadNationalId
);

// Step 8 (Pass path): activate the account and migrate verified data to users
router.post('/activate-account', authenticate, kycController.activateAccount);

module.exports = router;
