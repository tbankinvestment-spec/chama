const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../models/User');
const VerificationCode = require('../models/VerificationCode');
const connectDB = require('../config/db');
const { normalizeKenyanPhone, isValidKenyanPhone } = require('../utils/phoneNormalizer');
const { sendEmailVerificationOTP } = require('../services/emailService');
const { sendSMSVerificationOTP } = require('../services/smsService');
const { generateToken } = require('../middlewares/authMiddleware');

// Helper to determine next step from status
function determineNextStep(status) {
  switch (status) {
    case 'PENDING_EMAIL':
      return 5;
    case 'PENDING_PHONE':
      return 6;
    case 'PENDING_DOCUMENTS':
      return 7;
    case 'PENDING_REVIEW':
    case 'ACTIVE':
      return 9;
    default:
      return 1;
  }
}

// Helper to create and store OTP
async function generateAndSaveOTP(userId, channel) {
  // Generate random 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = VerificationCode.hashCode(code);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
  const resendAvailableAt = new Date(now.getTime() + 60 * 1000); // 60s cooldown

  // Delete any existing active code for this user and channel
  await VerificationCode.deleteMany({ userId, channel });

  await VerificationCode.create({
    userId,
    channel,
    codeHash,
    expiresAt,
    resendAvailableAt,
    attemptsRemaining: 3,
  });

  return code;
}

/**
 * Register: Handles Steps 1-4 combined
 * Creates the user account. Email OTP is NOT sent here — it is triggered
 * by the Login step (step 5) via /send-code, matching the new workflow.
 */
async function register(req, res) {
  try {
    const {
      fullName,
      name,
      email,
      phone,
      dob,
      dateOfBirth,
      dateofBirth,
      gender,
      LocationCounty,
      locationCounty,
      locationSubCuonty,
      locationSubCounty,
      locationvilage,
      locationVillage,
      location,
      personOneName,
      personOneGender,
      personOneRelationship,
      personOnePhone,
      personOneEmail,
      personTwoName,
      personTwoGender,
      personTwoRelationship,
      personTwoPhone,
      personTwoEmail,
      password,
    } = req.body;

    const resolvedCounty = String(LocationCounty || locationCounty || (location && location.county) || '').trim();
    const resolvedSubCounty = String(locationSubCuonty || locationSubCounty || (location && location.subCounty) || '').trim();
    const resolvedVillage = String(locationvilage || locationVillage || (location && (location.town || location.village)) || '').trim();

    // 1. Validate required fields (single canonical 'name' field)
    const displayName = String(name || fullName || '').trim();
    if (!displayName) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }
    const nameParts = displayName.split(/\s+/);
    if (nameParts.length < 2) {
      return res.status(400).json({ success: false, message: 'Full name must contain at least two names.' });
    }

    const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'A valid email address is required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();

    const rawDob = String(dateOfBirth || dob || dateofBirth || '').trim();
    if (!phone || !rawDob || !gender) {
      return res.status(400).json({ success: false, message: 'All personal information fields are required.' });
    }

    if (!resolvedCounty || !resolvedSubCounty || !resolvedVillage) {
      return res.status(400).json({ success: false, message: 'All location fields are required.' });
    }

    if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ success: false, message: 'Password needs 8+ characters with a letter and a number.' });
    }

    // 2. Validate Age (minimum 18)
    const parsedDob = new Date(rawDob);
    if (isNaN(parsedDob.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date of birth.' });
    }
    const ageDiffMs = Date.now() - parsedDob.getTime();
    const ageDate = new Date(ageDiffMs);
    const age = Math.abs(ageDate.getUTCFullYear() - 1970);
    if (age < 18) {
      return res.status(400).json({ success: false, message: 'You must be at least 18 years old to create a Chama account.' });
    }

    // 3. Normalize & validate primary phone
    const normalizedPhone = normalizeKenyanPhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, message: 'Invalid Kenyan phone number format. Use 07XXXXXXXX or 01XXXXXXXX.' });
    }

    // 4. Validate Person One and Person Two contact fields
    if (!personOneName || !personOneGender || !personOneRelationship) {
      return res.status(400).json({ success: false, message: 'Person One: name, gender and relationship are required.' });
    }
    if (!personTwoName || !personTwoGender || !personTwoRelationship) {
      return res.status(400).json({ success: false, message: 'Person Two: name, gender and relationship are required.' });
    }

    const normPersonOnePhone = normalizeKenyanPhone(personOnePhone);
    if (!normPersonOnePhone) return res.status(400).json({ success: false, message: 'Person One has an invalid Kenyan phone number.' });
    if (normPersonOnePhone === normalizedPhone) return res.status(400).json({ success: false, message: 'Person One phone cannot match your phone number.' });

    const normPersonTwoPhone = normalizeKenyanPhone(personTwoPhone);
    if (!normPersonTwoPhone) return res.status(400).json({ success: false, message: 'Person Two has an invalid Kenyan phone number.' });
    if (normPersonTwoPhone === normalizedPhone) return res.status(400).json({ success: false, message: 'Person Two phone cannot match your phone number.' });
    if (normPersonOnePhone === normPersonTwoPhone) return res.status(400).json({ success: false, message: 'Person One and Person Two cannot share the same phone number.' });

    if (!personOneEmail || !EMAIL_REGEX.test(personOneEmail.trim())) return res.status(400).json({ success: false, message: 'Person One has an invalid email address.' });
    const normPersonOneEmail = personOneEmail.toLowerCase().trim();
    if (normPersonOneEmail === normalizedEmail) return res.status(400).json({ success: false, message: 'Person One email cannot match your email address.' });

    if (!personTwoEmail || !EMAIL_REGEX.test(personTwoEmail.trim())) return res.status(400).json({ success: false, message: 'Person Two has an invalid email address.' });
    const normPersonTwoEmail = personTwoEmail.toLowerCase().trim();
    if (normPersonTwoEmail === normalizedEmail) return res.status(400).json({ success: false, message: 'Person Two email cannot match your email address.' });
    if (normPersonOneEmail === normPersonTwoEmail) return res.status(400).json({ success: false, message: 'Person One and Person Two cannot share the same email address.' });

    
    // Hash password (bcrypt cost 12)
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    let newUser;
    // Ensure the database is actually reachable before persisting — the pending
    // record must land in the 'pendingverifiedaccount' collection.
    let isDbConnected = !!(mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db);
    if (!isDbConnected) {
      await connectDB().catch(() => {});
      isDbConnected = !!(mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db);
    }

    if (!isDbConnected) {
      return res.status(503).json({
        success: false,
        message: 'Database is unavailable, so your details could not be saved. Please try again in a moment.',
      });
    }

    // Already an activated member? Block re-registration.
    const activated = await mongoose.connection.db.collection('users').findOne({ email: normalizedEmail });
    if (activated) {
      return res.status(409).json({ success: false, message: 'An account with this email address already exists.' });
    }

    const registrationFields = {
      phone: normalizedPhone,
      email: normalizedEmail,
      name: displayName,
      dateOfBirth: rawDob,
      gender: gender.toLowerCase(),
      LocationCounty: resolvedCounty,
      locationSubCuonty: resolvedSubCounty,
      locationvilage: resolvedVillage,
      personOneName: personOneName.trim(),
      personOneGender: personOneGender.toLowerCase(),
      personOneRelationship: personOneRelationship.trim(),
      personOnePhone: normPersonOnePhone,
      personOneEmail: normPersonOneEmail,
      personTwoName: personTwoName.trim(),
      personTwoGender: personTwoGender.toLowerCase(),
      personTwoRelationship: personTwoRelationship.trim(),
      personTwoPhone: normPersonTwoPhone,
      personTwoEmail: normPersonTwoEmail,
      passwordHash,
      memberIndex: null,
      emailVerified: false,
      phoneVerified: false,
      kycCompleted: false,
      status: 'PENDING_EMAIL',
      registrationTime: new Date(),
    };

    // Upsert into 'pendingverifiedaccount': re-submitting (for example after the
    // password is confirmed, then again at review) updates the same pending
    // record instead of failing with a duplicate error.
    const existingEmail = await User.findOne({ email: normalizedEmail });
    const existingPhone = await User.findOne({ phone: normalizedPhone });

    if (existingPhone && (!existingEmail || String(existingPhone._id) !== String(existingEmail._id))) {
      return res.status(409).json({ success: false, message: 'An account with this phone number already exists.' });
    }

    if (existingEmail) {
      Object.assign(existingEmail, registrationFields);
      if (existingEmail.status === 'PENDING_VERIFICATION' || !existingEmail.status) {
        existingEmail.status = 'PENDING_EMAIL';
      }
      await existingEmail.save();
      newUser = existingEmail;
    } else {
      newUser = await User.create(registrationFields);
    }

    const token = generateToken(newUser, 'onboarding');

    return res.status(201).json({
      success: true,
      message: 'Account created successfully. Please sign in to continue verification.',
      status: 'PENDING_EMAIL',
      nextStep: 5,
      token,
      user: typeof newUser.toSafeJSON === 'function' ? newUser.toSafeJSON() : newUser,
    });
  } catch (error) {
    console.error('[Register Error]', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error during registration.' });
  }
}

/**
 * Verify Email: Step 5
 */
async function verifyEmail(req, res) {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Verification code is required.' });
    }

    const record = await VerificationCode.findOne({
      userId: req.user._id,
      channel: 'EMAIL',
    });

    if (!record) {
      return res.status(400).json({ success: false, message: 'No active email verification code found or it has expired. Please request a new code.' });
    }

    if (new Date() > record.expiresAt) {
      await VerificationCode.deleteOne({ _id: record._id });
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new code.' });
    }

    if (record.attemptsRemaining <= 0) {
      await VerificationCode.deleteOne({ _id: record._id });
      return res.status(400).json({ success: false, message: 'Too many incorrect attempts. Please request a new verification code.' });
    }

    const isValid = record.verifyCode(code);
    if (!isValid) {
      record.attemptsRemaining -= 1;
      await record.save();
      return res.status(400).json({
        success: false,
        message: `Incorrect code. ${record.attemptsRemaining} attempt(s) remaining.`,
      });
    }

    // Success: update User state
    await VerificationCode.deleteOne({ _id: record._id });
    req.user.isEmailVerified = true;
    req.user.emailVerified = true;
    req.user.status = 'PENDING_PHONE';
    await req.user.save();

    // SMS code is NOT auto-sent here — the user will explicitly request it on Step 6

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully. Please proceed to phone verification.',
      status: 'PENDING_PHONE',
      nextStep: 6,
      phone: req.user.phone,
    });
  } catch (error) {
    console.error('[Verify Email Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to verify email code.' });
  }
}

/**
 * Verify Phone: Step 6
 */
async function verifyPhone(req, res) {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'SMS verification code is required.' });
    }

    const record = await VerificationCode.findOne({
      userId: req.user._id,
      channel: 'SMS',
    });

    if (!record) {
      return res.status(400).json({ success: false, message: 'No active SMS code found or it has expired. Please request a new code.' });
    }

    if (new Date() > record.expiresAt) {
      await VerificationCode.deleteOne({ _id: record._id });
      return res.status(400).json({ success: false, message: 'SMS verification code has expired. Please request a new code.' });
    }

    if (record.attemptsRemaining <= 0) {
      await VerificationCode.deleteOne({ _id: record._id });
      return res.status(400).json({ success: false, message: 'Too many incorrect attempts. Please request a new code.' });
    }

    const isValid = record.verifyCode(code);
    if (!isValid) {
      record.attemptsRemaining -= 1;
      await record.save();
      return res.status(400).json({
        success: false,
        message: `Incorrect code. ${record.attemptsRemaining} attempt(s) remaining.`,
      });
    }

    // Success: update User state
    await VerificationCode.deleteOne({ _id: record._id });
    req.user.isPhoneVerified = true;
    req.user.status = 'PENDING_DOCUMENTS';
    await req.user.save();

    return res.status(200).json({
      success: true,
      message: 'Phone verified successfully. Please upload your identification documents.',
      status: 'PENDING_DOCUMENTS',
      nextStep: 7,
    });
  } catch (error) {
    console.error('[Verify Phone Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to verify phone code.' });
  }
}

/**
 * Resend OTP Code (Email or SMS)
 */
async function resendCode(req, res) {
  try {
    const { channel } = req.body;
    if (!['EMAIL', 'SMS'].includes(channel)) {
      return res.status(400).json({ success: false, message: 'Invalid channel specified.' });
    }

    const existingRecord = await VerificationCode.findOne({
      userId: req.user._id,
      channel,
    });

    const now = new Date();
    if (existingRecord && existingRecord.resendAvailableAt > now) {
      const waitSeconds = Math.ceil((existingRecord.resendAvailableAt - now) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds} second(s) before requesting a new code.`,
        cooldownSeconds: waitSeconds,
      });
    }

    const code = await generateAndSaveOTP(req.user._id, channel);

    if (channel === 'EMAIL') {
      await sendEmailVerificationOTP(req.user.email, code, req.user.name);
    } else {
      await sendSMSVerificationOTP(req.user.phone, code);
    }

    return res.status(200).json({
      success: true,
      message: `A fresh ${channel.toLowerCase()} verification code has been dispatched.`,
      cooldownSeconds: 60,
    });
  } catch (error) {
    console.error('[Resend Code Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to resend code.' });
  }
}

/**
 * Login: "Personal Account Login"
 * Handles Returning Users + Resumes Unfinished Registration
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid input format.' });
    }

    const isDbConnected = !!(mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db);
    const normalizedEmail = email.toLowerCase().trim();
    let user = null;
    let activatedUser = null;

    if (isDbConnected) {
      // Accounts that completed activation are migrated into the 'users' collection.
      activatedUser = await mongoose.connection.db
        .collection('users')
        .findOne({ email: normalizedEmail });

      // Otherwise fall back to the pending registration record.
      if (!activatedUser) {
        user = await User.findOne({ email: normalizedEmail });
      }
    } else {
      const pending = req.session?.pendingRegistration || req.session?.user;
      if (pending && pending.email === normalizedEmail) {
        user = pending;
      }
    }

    if (!user && !activatedUser) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    let isMatch = false;
    if (activatedUser) {
      // Verified account read straight from the users collection (plain document).
      isMatch = activatedUser.passwordHash
        ? await bcrypt.compare(password, activatedUser.passwordHash)
        : false;
    } else if (typeof user.comparePassword === 'function') {
      isMatch = await user.comparePassword(password);
    } else if (user.passwordHash) {
      isMatch = await bcrypt.compare(password, user.passwordHash);
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // Verified against the users collection → full access, straight to the dashboard.
    if (activatedUser) {
      await mongoose.connection.db
        .collection('users')
        .updateOne({ _id: activatedUser._id }, { $set: { lastLoginAt: new Date() } });

      const safeUser = { ...activatedUser, status: 'ACTIVE' };
      delete safeUser.passwordHash;
      delete safeUser.pinkey;

      // Mirror the verified account into the session so the session-guarded
      // /dashboard route lets the user in right after the client redirects.
      req.session.user = {
        _id: activatedUser._id,
        id: String(activatedUser._id),
        name: activatedUser.name,
        email: activatedUser.email,
        phone: activatedUser.phone,
        status: 'ACTIVE',
        memberIndex: activatedUser.memberIndex,
      };

      const token = generateToken(
        { _id: activatedUser._id, email: activatedUser.email, status: 'ACTIVE' },
        'full'
      );

      return res.status(200).json({
        success: true,
        message: 'Login successful',
        token,
        status: 'ACTIVE',
        nextStep: null,
        user: safeUser,
      });
    }

    if (typeof user.save === 'function') {
      user.lastLoginAt = new Date();
      await user.save();
    }

    const scope = user.status === 'ACTIVE' ? 'full' : 'onboarding';
    const token = generateToken(user, scope);
    const nextStep = determineNextStep(user.status);

    return res.status(200).json({
      success: true,
      message: user.status === 'ACTIVE' ? 'Login successful' : 'Please complete your pending registration steps.',
      token,
      status: user.status,
      nextStep,
      user: user.toSafeJSON(),
    });
  } catch (error) {
    console.error('[Login Error]', error);
    return res.status(500).json({ success: false, message: 'Login failed.' });
  }
}

/**
 * Get Current Status & Resume Point
 */
async function getStatus(req, res) {
  try {
    const user = req.user;
    const nextStep = determineNextStep(user.status);

    return res.status(200).json({
      success: true,
      status: user.status,
      nextStep,
      user: user.toSafeJSON(),
      completedRequirements: {
        emailVerified: user.isEmailVerified,
        phoneVerified: user.isPhoneVerified,
        passportUploaded: !!user.documents.passportPhotoUrl,
        idUploaded: !!user.documents.idDocumentFrontUrl,
      },
    });
  } catch (error) {
    console.error('[Get Status Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve account status.' });
  }
}

/**
 * Helper: normalize the channel string from the frontend.
 * Accepts 'email' | 'phone' (frontend) and 'EMAIL' | 'SMS' (backend).
 * Returns the uppercase backend channel or null if invalid.
 */
function normalizeChannel(channel) {
  if (!channel) return null;
  const c = String(channel).toLowerCase();
  if (c === 'email') return 'EMAIL';
  if (c === 'phone' || c === 'sms') return 'SMS';
  return null;
}

/**
 * Unified Send Code endpoint (used by the new registration workflow).
 * Accepts channel 'email' or 'phone' and dispatches the OTP.
 */
async function sendCode(req, res) {
  try {
    const { channel } = req.body;
    const normalizedChannel = normalizeChannel(channel);
    if (!normalizedChannel) {
      return res.status(400).json({ success: false, message: 'Invalid channel specified. Use "email" or "phone".' });
    }

    const existingRecord = await VerificationCode.findOne({
      userId: req.user._id,
      channel: normalizedChannel,
    });

    const now = new Date();
    if (existingRecord && existingRecord.resendAvailableAt > now) {
      const waitSeconds = Math.ceil((existingRecord.resendAvailableAt - now) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds} second(s) before requesting a new code.`,
        cooldownSeconds: waitSeconds,
      });
    }

    const code = await generateAndSaveOTP(req.user._id, normalizedChannel);

    if (normalizedChannel === 'EMAIL') {
      await sendEmailVerificationOTP(req.user.email, code, req.user.name);
    } else {
      await sendSMSVerificationOTP(req.user.phone, code);
    }

    return res.status(200).json({
      success: true,
      message: `A fresh ${normalizedChannel.toLowerCase()} verification code has been dispatched.`,
      cooldownSeconds: 60,
    });
  } catch (error) {
    console.error('[Send Code Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to send verification code.' });
  }
}

/**
 * Unified Verify Code endpoint (used by the new registration workflow).
 * Accepts channel 'email' or 'phone' and the 6-digit code.
 * On email success, automatically triggers the phone SMS code.
 */
async function verifyCode(req, res) {
  try {
    const { channel, code } = req.body;
    const normalizedChannel = normalizeChannel(channel);
    if (!normalizedChannel) {
      return res.status(400).json({ success: false, message: 'Invalid channel specified. Use "email" or "phone".' });
    }
    if (!code) {
      return res.status(400).json({ success: false, message: 'Verification code is required.' });
    }

    const record = await VerificationCode.findOne({
      userId: req.user._id,
      channel: normalizedChannel,
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        message: `No active ${normalizedChannel.toLowerCase()} verification code found or it has expired. Please request a new code.`,
      });
    }

    if (new Date() > record.expiresAt) {
      await VerificationCode.deleteOne({ _id: record._id });
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new code.' });
    }

    if (record.attemptsRemaining <= 0) {
      await VerificationCode.deleteOne({ _id: record._id });
      return res.status(400).json({ success: false, message: 'Too many incorrect attempts. Please request a new verification code.' });
    }

    const isValid = record.verifyCode(code);
    if (!isValid) {
      record.attemptsRemaining -= 1;
      await record.save();
      return res.status(400).json({
        success: false,
        message: `Incorrect code. ${record.attemptsRemaining} attempt(s) remaining.`,
      });
    }

    // Success: delete the used code
    await VerificationCode.deleteOne({ _id: record._id });

    if (normalizedChannel === 'EMAIL') {
      req.user.isEmailVerified = true;
      req.user.emailVerified = true;
      req.user.status = 'PENDING_PHONE';
      await req.user.save();

      // SMS code is NOT auto-sent here; the user explicitly requests it via Request Code on Step 6

      return res.status(200).json({
        success: true,
        message: 'Email verified successfully. Please proceed to phone verification.',
        status: 'PENDING_PHONE',
        nextStep: 6,
        phone: req.user.phone,
      });
    } else {
      // SMS verification
      req.user.isPhoneVerified = true;
      req.user.status = 'PENDING_DOCUMENTS';
      await req.user.save();

      return res.status(200).json({
        success: true,
        message: 'Phone verified successfully. Please upload your identification documents.',
        status: 'PENDING_DOCUMENTS',
        nextStep: 8,
      });
    }
  } catch (error) {
    console.error('[Verify Code Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to verify code.' });
  }
}

module.exports = {
  register,
  verifyEmail,
  verifyPhone,
  resendCode,
  sendCode,
  verifyCode,
  login,
  getStatus,
};
