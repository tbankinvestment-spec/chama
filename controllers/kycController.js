const mongoose = require('mongoose');
const User = require('../models/User');
const {
  validateFaceSubmission,
  validateIdScan,
  validateIdentity,
  asObject,
} = require('../services/kycValidation');

/**
 * Upload Passport Photo (Step 7)
 * The image is captured from the device camera on the client, which also
 * reports a liveness ("real person") report and simple face properties.
 * Both are re-validated here before the photo is accepted.
 */
async function uploadPassportPhoto(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please capture a passport photo with your camera.' });
    }

    const liveness = asObject(req.body.liveness);
    const face = asObject(req.body.face);

    const check = validateFaceSubmission({ liveness, face });
    if (!check.valid) {
      return res.status(400).json({
        success: false,
        message: check.errors[0] || 'The photo did not pass the real-person check. Please retake it.',
        errors: check.errors,
      });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const user = req.user;

    user.documents.passportPhotoUrl = fileUrl;
    user.documents.uploadedAt = new Date();
    user.documents.liveness = {
      blinkDetected: !!liveness.blinkDetected,
      motionScore: liveness.motionScore,
      framesAnalyzed: liveness.framesAnalyzed,
      realPerson: liveness.realPerson !== false,
      manual: liveness.manual === true,
    };
    user.documents.faceProperties = {
      faceDetected: !!face.faceDetected,
      faceRatio: face.faceRatio,
      faceBox: face.faceBox,
      skinTone: face.skinTone,
      brightness: face.brightness,
      sharpness: face.sharpness,
    };
    // Legacy top-level field kept in sync for backwards compatibility
    user.passportPhoto = fileUrl;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Passport photo captured and verified successfully.',
      passportPhotoUrl: fileUrl,
      liveness: user.documents.liveness,
      faceProperties: user.documents.faceProperties,
      warnings: check.warnings,
      nextStep: 8,
    });
  } catch (error) {
    console.error('[Upload Passport Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to upload passport photo.' });
  }
}

/**
 * Upload National ID Documents (Step 8)
 * Captures the ID from the device camera and validates the document-scan
 * quality report. Also persists the identity details the user confirmed
 * (name, ID number, region, block) on the confirmation card.
 */
async function uploadNationalId(req, res) {
  try {
    const files = req.files;
    if (!files || (!files.idFront && !files.idBack && !req.file)) {
      return res.status(400).json({ success: false, message: 'Please capture your National ID with the camera.' });
    }

    const scan = asObject(req.body.scan);
    const scanCheck = validateIdScan({ scan });
    if (!scanCheck.valid) {
      return res.status(400).json({
        success: false,
        message: scanCheck.errors[0] || 'The ID scan did not pass quality checks. Please rescan.',
        errors: scanCheck.errors,
      });
    }

    const identityCheck = validateIdentity({ identity: req.body.identity });
    if (!identityCheck.valid) {
      return res.status(400).json({
        success: false,
        message: identityCheck.errors[0] || 'Please confirm your ID details.',
        errors: identityCheck.errors,
      });
    }

    const user = req.user;

    if (files.idFront && files.idFront[0]) {
      user.documents.idDocumentFrontUrl = `/uploads/${files.idFront[0].filename}`;
    }
    if (files.idBack && files.idBack[0]) {
      user.documents.idDocumentBackUrl = `/uploads/${files.idBack[0].filename}`;
    }

    // In case a single combined file upload was used
    if (req.file) {
      user.documents.idDocumentFrontUrl = `/uploads/${req.file.filename}`;
      user.documents.idDocumentBackUrl = `/uploads/${req.file.filename}`;
    }

    user.documents.uploadedAt = new Date();
    user.documents.idScan = {
      documentDetected: scan.documentDetected !== false,
      documentRatio: scan.documentRatio,
      edgeDensity: scan.edgeDensity,
      brightness: scan.brightness,
      sharpness: scan.sharpness,
      aspect: scan.aspect,
    };

    user.identity = {
      ...identityCheck.identity,
      confirmedAt: new Date(),
    };
    // Legacy top-level field kept in sync for backwards compatibility
    user.nationalIdPhoto = user.documents.idDocumentFrontUrl;

    // Document uploads complete -> move the state machine forward
    if (user.documents.passportPhotoUrl && user.documents.idDocumentFrontUrl) {
      user.status = 'PENDING_REVIEW';
      user.kycCompleted = true;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'National ID verified. All onboarding steps completed!',
      status: user.status,
      nextStep: 9,
      identity: user.identity,
      documents: user.documents,
      warnings: scanCheck.warnings,
    });
  } catch (error) {
    console.error('[Upload ID Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to upload National ID.' });
  }
}

/**
 * Activate Account (Step 8 — "Pass" path)
 * The user pressed Pass and chose not to upload ID content. All data already
 * captured/verified during registration is migrated from the
 * 'pendingverifiedaccount' collection into the 'users' collection and the
 * account is marked ACTIVE.
 */
async function activateAccount(req, res) {
  try {
    const user = req.user;

    if (!mongoose.connection || mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
      return res.status(503).json({ success: false, message: 'Database is unavailable. Please try again shortly.' });
    }

    const db = mongoose.connection.db;
    const data = user.toObject();
    data.status = 'ACTIVE';
    data.activatedAt = new Date();
    // 'name' is the single canonical name field — drop the legacy duplicate.
    delete data.fullName;

    // Keep an existing member index, otherwise assign the next sequential one.
    const existing = await db.collection('users').findOne({ _id: data._id });
    if (existing && typeof existing.memberIndex === 'number') {
      data.memberIndex = existing.memberIndex;
    } else {
      const last = await db
        .collection('users')
        .find({ memberIndex: { $type: 'number' } })
        .sort({ memberIndex: -1 })
        .limit(1)
        .toArray();
      data.memberIndex = last.length ? last[0].memberIndex + 1 : 1;
    }

    // Idempotent migration: remove any previous copy for this email, then write
    // the verified record into the users collection.
    await db.collection('users').deleteMany({ email: data.email, _id: { $ne: data._id } });
    await db.collection('users').replaceOne({ _id: data._id }, data, { upsert: true });

    // The account now lives in the users collection, so remove it completely
    // from the pending collection (by id and by email to catch any duplicates).
    await db.collection('pendingverifiedaccount').deleteMany({
      $or: [{ _id: data._id }, { email: data.email }],
    });

    // Mirror the freshly activated account into the session so the
    // session-guarded /dashboard route lets the user straight in.
    req.session.user = {
      _id: data._id,
      id: String(data._id),
      name: data.name,
      email: data.email,
      phone: data.phone,
      status: 'ACTIVE',
      memberIndex: data.memberIndex,
    };

    return res.status(200).json({
      success: true,
      message: 'Your account has been activated successfully.',
      status: data.status,
      memberIndex: data.memberIndex,
      migrated: true,
    });
  } catch (error) {
    console.error('[Activate Account Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to activate your account.' });
  }
}

module.exports = {
  uploadPassportPhoto,
  uploadNationalId,
  activateAccount,
};
