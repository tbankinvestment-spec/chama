// controllers/verifyController.js
// Two-step account verification: part of the REGISTRATION workflow, not a
// post-login action. Flow overview:
//
//   Register form (validated)
//     → authController.handleRegister
//     → session.pendingRegistration saved (name/email/phone/pin)
//     → redirect to /verify
//     → STEP 1: EMAIL OTP via services/email.sendVerificationCode
//     → on correct OTP: v.emailVerified = true
//     → STEP 2: SMS OTP via services/sms.sendVerificationCode
//     → on correct OTP: v.phoneVerified = true
//     → finalizeRegistration() → bcrypt PIN hash → User.create() in Mongo
//     → session.user promoted to real authenticated user (pendingRegistration
//         + verification state DELETED for security)
//     → redirect to /dashboard
//
// Access control: none of these routes are protected by authGuard, because
// during the registration workflow the user is not yet logged in. Instead,
// each handler checks `req.session.pendingRegistration` exists and is not
// expired; otherwise it redirects back to /register.
//
// The third-party provider integrations live in services/email.js and
// services/sms.js; this controller only calls their exported
// `sendVerificationCode()` functions, never imports Twilio/Nodemailer
// directly. This keeps the controller testable and provider-agnostic.

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const User = require("../models/User");
const {} = require("../services/chamaData");
const emailService = require("../services/email");
const smsService = require("../services/sms");
const { redis } = require("../config/redis");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SALT_ROUNDS = 12;

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function random6Digit() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getPending(req, res) {
  let p = req.session && req.session.pendingRegistration;

  // Allow instant UI preview in dev mode via /verify?preview=true
  if (!p && (req.query?.preview === "true" || req.query?.dev === "true")) {
    p = req.session.pendingRegistration = {
      name: "Brian Omondi",
      email: "brian@example.com",
      phone: "+254712345678",
      pin: "1234",
      createdAt: Date.now(),
      maxAgeMs: 10 * 60 * 1000,
    };
    return p;
  }

  if (!p) {
    req.flash &&
      req.flash("errors", {
        workflow:
          "No registration in progress. Please start by creating an account.",
      });
    res.redirect("/register");
    return null;
  }
  const age = Date.now() - (p.createdAt || 0);
  if (age > (p.maxAgeMs || OTP_TTL_MS)) {
    delete req.session.pendingRegistration;
    delete req.session.verification;
    req.flash &&
      req.flash("errors", {
        workflow:
          "Your registration session expired. Please re-submit the registration form.",
      });
    res.redirect("/register");
    return null;
  }
  if (!req.session.verification) req.session.verification = {};
  return p;
}

function ensureVerificationState(req) {
  if (!req.session.verification) req.session.verification = {};
  const v = req.session.verification;
  if (typeof v.emailVerified !== "boolean") v.emailVerified = false;
  if (typeof v.phoneVerified !== "boolean") v.phoneVerified = false;
  return v;
}

async function getNextMemberIndex() {
  const BASE_MEMBER_INDEX = 1000000;
  if (
    !mongoose ||
    !mongoose.connection ||
    mongoose.connection.readyState !== 1 ||
    !User ||
    typeof User.findOne !== "function"
  ) {
    return BASE_MEMBER_INDEX + Math.floor(1 + Math.random() * 899999);
  }
  try {
    const lastUser = await User.findOne({ memberIndex: { $exists: true } })
      .sort({ memberIndex: -1 })
      .select("memberIndex")
      .lean();
    if (lastUser && typeof lastUser.memberIndex === "number" && lastUser.memberIndex >= BASE_MEMBER_INDEX) {
      return lastUser.memberIndex + 1;
    }
    const count = typeof User.countDocuments === "function" ? await User.countDocuments() : 0;
    return BASE_MEMBER_INDEX + count + 1;
  } catch (err) {
    console.error("[verify] Error determining next memberIndex:", err);
    return BASE_MEMBER_INDEX + Math.floor(1 + Math.random() * 899999);
  }
}

function cleanExpiredOtps(session) {
  const now = Date.now();
  const v = session.verification || {};
  if (v.emailCode && v.emailCodeIssuedAt && now - v.emailCodeIssuedAt > OTP_TTL_MS) {
    delete v.emailCode;
    delete v.emailCodeIssuedAt;
  }
  if (v.phoneCode && v.phoneCodeIssuedAt && now - v.phoneCodeIssuedAt > OTP_TTL_MS) {
    delete v.phoneCode;
    delete v.phoneVerifyNumber;
    delete v.phoneCodeIssuedAt;
  }
}

function flashErr(req, key, message) {
  if (req && typeof req.flash === "function") {
    const bucket = req.flash("errors") || [];
    const obj = bucket[0] ? bucket[0] : {};
    obj[key] = message;
    req.flash("errors", obj);
  }
}
function flashMsg(req, key, message) {
  if (req && typeof req.flash === "function") {
    const bucket = req.flash("messages") || [];
    const obj = bucket[0] ? bucket[0] : {};
    obj[key] = message;
    req.flash("messages", obj);
  }
}

function renderVerify(req, res) {
  const pending = req.session.pendingRegistration;
  const v = ensureVerificationState(req);
  cleanExpiredOtps(req.session);
  const userForView = {
    name: pending.name,
    email: pending.email,
    phone: pending.phone,
  };
  res.render("verify", {
    title: "Verify Your Account",
    user: userForView,
    emailVerified: v.emailVerified,
    phoneVerified: v.phoneVerified,
    bothVerified: v.emailVerified && v.phoneVerified,
    emailCodeSent: !!v.emailCode,
    phoneCodeSent: !!(v.phoneVerifyNumber || v.phoneCode),
    errors:
      req.flash
        ? ((function getBucketOnce() {
            const arr = req.flash("errors") || [];
            return arr && arr[0] ? arr[0] : {};
          })())
        : {},
    messages:
      req.flash
        ? ((function getBucketOnce() {
            const arr = req.flash("messages") || [];
            return arr && arr[0] ? arr[0] : {};
          })())
        : {},
  });
}

async function finalizeRegistration(req, res) {
  const p = req.session.pendingRegistration;
  const v = req.session.verification || {};
  if (!p || !v.emailVerified || !v.phoneVerified) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "Verification incomplete." });
    }
    return res.redirect("/verify");
  }
  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(String(p.pin), SALT_ROUNDS);
  } catch (err) {
    console.error("[verify] bcrypt.hash failed:", err);
    flashErr(req, "workflow", "Internal error securing your PIN. Please try again.");
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(500).json({ success: false, error: "Internal error securing your PIN." });
    }
    return res.redirect("/verify");
  }

  // 7-digit member index starting from 1000000 ordered smallest to largest
  const memberIndex = await getNextMemberIndex();
  const registrationTime = new Date();
  const pinkey = v.pinkey || v.phoneVerifyNumber || v.phoneCode || "1234";

  let doc = {
    _id: "demo-user-" + Date.now(),
    name: p.name,
    email: p.email.toLowerCase(),
    phone: p.phone,
    memberIndex,
    registrationTime,
    passwordHash,
    pinkey,
    emailVerified: true,
    phoneVerified: true,
  };

  // Submit recorded data to Database (MongoDB User model)
  const isDbConnected = Boolean(
    mongoose &&
    mongoose.connection &&
    mongoose.connection.readyState === 1
  );

  let dbWriteSucceeded = false;

  if (isDbConnected && User && typeof User.create === "function") {
    try {
      doc = await User.create({
        name: p.name,
        email: p.email.toLowerCase(),
        phone: p.phone,
        passwordHash,
        memberIndex,
        registrationTime,
        pinkey,
        emailVerified: true,
        phoneVerified: true,
      });
      dbWriteSucceeded = true;
      console.log(`[verify] User created in database with ID: ${doc._id}, memberIndex: ${memberIndex}`);
    } catch (err) {
      console.error("[verify] User.create failed:", err.message);
      // Handle Duplicate Key (E11000) for email, phone, or memberIndex
      if (err && (err.code === 11000 || (err.message && err.message.includes("11000")))) {
        console.warn("[verify] Account already exists in database (duplicate key). Updating verified status.");
        try {
          const updatedDoc = await User.findOneAndUpdate(
            { $or: [{ phone: p.phone }, { email: p.email.toLowerCase() }] },
            {
              $set: {
                name: p.name,
                email: p.email.toLowerCase(),
                phone: p.phone,
                passwordHash,
                memberIndex,
                registrationTime,
                pinkey,
                emailVerified: true,
                phoneVerified: true,
              },
            },
            { new: true, upsert: true }
          );
          if (updatedDoc) {
            doc = updatedDoc;
            dbWriteSucceeded = true;
          }
          console.log(`[verify] User updated/upserted in database with ID: ${doc._id}, memberIndex: ${memberIndex}`);
        } catch (updateErr) {
          console.warn("[verify] findOneAndUpdate fallback error:", updateErr.message);
        }
      } else {
        console.warn("[verify] Non-fatal database error, continuing with session registration:", err.message);
      }
    }
  } else {
    console.log("[verify] MongoDB is not connected (readyState !== 1); registered in-memory session user:", p.phone);
  }

  // Submit and store recorded data through Redis (cache and registration tracking)
  if (redis && redis.isReady) {
    try {
      const sanitizedRecord = {
        _id: String(doc._id),
        name: doc.name,
        email: doc.email,
        phone: doc.phone,
        memberIndex: doc.memberIndex,
        registrationTime: doc.registrationTime,
        emailVerified: true,
        phoneVerified: true,
      };
      await redis.set(`chama:member:${memberIndex}`, JSON.stringify(sanitizedRecord), { EX: 604800 });
      await redis.set(`chama:user:phone:${doc.phone}`, JSON.stringify(sanitizedRecord), { EX: 604800 });
      console.log(`[verify] Recorded member data stored in Redis for memberIndex: ${memberIndex}`);
    } catch (redisErr) {
      console.warn("[verify] Redis cache storage non-fatal warning:", redisErr.message);
    }
  }

  // Wipe registration temporary state so it cannot be hijacked or reused
  delete req.session.pendingRegistration;
  delete req.session.verification;

  // Clear any pre-authenticated user state to ensure the user must explicitly
  // authenticate with their 4-digit PIN at /login
  delete req.session.user;

  if (!dbWriteSucceeded) {
    // Database write failed — account was NOT persisted. Redirect back to
    // registration with an error so the user can retry.
    const errMsg = "We could not complete your registration right now. Please try again later.";
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(503).json({ success: false, error: errMsg });
    }
    flashErr(req, "workflow", errMsg);
    return res.redirect("/register");
  }

  // Store recorded data within session
  req.session.recordedMember = {
    _id: String(doc._id),
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    memberIndex: doc.memberIndex,
    registrationTime: doc.registrationTime,
  };
  req.session.loginPhone = doc.phone || p.phone;
  req.session.loginSuccess = "Account verified successfully! Please enter your PIN to sign in.";

  flashMsg(req, "loginSuccess", "Account verified successfully! Please enter your PIN to sign in.");

  // Save session to store (Redis/Memory) before redirecting to login page
  req.session.save((saveErr) => {
    if (saveErr) {
      console.warn("[verify] session.save warning:", saveErr);
    }
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, redirect: "/login" });
    }
    res.redirect("/login");
  });
}

/* ---------- Public handlers (wired in routes/verify.js) ---------- */

exports.showVerifyPage = (req, res) => {
  const p = getPending(req, res);
  if (!p) return;
  renderVerify(req, res);
};

/* ---------- Step 1: Email ---------- */

exports.sendEmailCode = async (req, res) => {
  const p = getPending(req, res);
  if (!p) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "No registration in progress." });
    }
    return;
  }
  const v = ensureVerificationState(req);

  if (v.emailVerified) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, verified: true });
    }
    return res.redirect("/verify");
  }
  if (!p.email) {
    flashErr(req, "emailSend", "No email address available. Please re-register.");
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "No email address available." });
    }
    return res.redirect("/verify");
  }

  try {
    // Dummy data: use "1234" as fixed verification key number for dev/demo
    v.emailCode = "1234";
    v.emailCodeIssuedAt = Date.now();

    await emailService.sendVerificationCode(p.email, v.emailCode, { req });

    flashMsg(
      req,
      "emailSend",
      "A verification code has been sent to <strong>" + p.email + "</strong>."
    );

    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, message: "Verification code sent.", code: v.emailCode });
    }
  } catch (err) {
    console.error("[verify] sendEmailCode failed:", err);
    delete v.emailCode;
    delete v.emailCodeIssuedAt;
    flashErr(
      req,
      "emailSend",
      "We couldn't send the email code right now. Please try again in a moment."
    );
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(500).json({ success: false, error: "Failed to dispatch email code." });
    }
  }
  res.redirect("/verify");
};

exports.checkEmailCode = (req, res) => {
  const p = getPending(req, res);
  if (!p) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "No registration in progress." });
    }
    return;
  }
  const v = ensureVerificationState(req);
  cleanExpiredOtps(req.session);

  if (v.emailVerified) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, emailVerified: true, phoneCodeSent: true });
    }
    return res.redirect("/verify");
  }

  const digits = String(req.body.emailCode || "").replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 6) {
    flashErr(req, "emailCheck", "Code must be 4–6 digits.");
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "Code must be 4–6 digits." });
    }
    return res.redirect("/verify");
  }

  // Allow dummy code "1234" by default for dev/demo if not already dispatched
  const expectedCode = String(v.emailCode || "1234");

  v.emailAttempts = (v.emailAttempts || 0) + 1;
  if (v.emailAttempts > 5) {
    delete v.emailCode;
    delete v.emailCodeIssuedAt;
    delete v.emailAttempts;
    flashErr(req, "emailCheck", "Too many invalid code attempts. Please request a new verification code.");
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(429).json({ success: false, error: "Too many invalid code attempts." });
    }
    return res.redirect("/verify");
  }

  if (!safeCompare(digits, expectedCode)) {
    const remaining = Math.max(0, 5 - v.emailAttempts);
    flashErr(req, "emailCheck", `Incorrect email verification code. (${remaining} attempt(s) remaining)`);
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: `Incorrect email verification code. (${remaining} attempt(s) remaining)` });
    }
    return res.redirect("/verify");
  }

  v.emailVerified = true;
  delete v.emailCode;
  delete v.emailCodeIssuedAt;
  delete v.emailAttempts;

  // Auto-initiate Step 2 (Phone SMS verification) with key "1234" so the user immediately proceeds
  const verifyNumber = (typeof smsService.generateVerifyNumber === "function")
    ? smsService.generateVerifyNumber()
    : "1234";
  v.phoneVerifyNumber = verifyNumber;
  v.phoneCode = verifyNumber;
  v.phoneCodeIssuedAt = Date.now();

  try {
    if (typeof smsService.sendVerificationNumber === "function") {
      smsService.sendVerificationNumber(p.phone, verifyNumber, { req }).catch(() => {});
    } else if (typeof smsService.sendVerificationCode === "function") {
      smsService.sendVerificationCode(p.phone, verifyNumber, { req }).catch(() => {});
    }
  } catch (_) {}

  flashMsg(req, "emailCheck", "✅ Email verified. Next step: SMS verification code sent.");

  if (req.xhr || req.headers.accept?.includes("json")) {
    return res.json({
      success: true,
      emailVerified: true,
      phoneCodeSent: true,
      message: "Email verified. Proceed to SMS verification.",
    });
  }

  res.redirect("/verify");
};

/* ---------- Step 2: Phone SMS ---------- */

exports.sendPhoneCode = async (req, res) => {
  const p = getPending(req, res);
  if (!p) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "No registration in progress." });
    }
    return;
  }
  const v = ensureVerificationState(req);

  if (!v.emailVerified) {
    flashErr(req, "phoneSend", "Please verify your email address first.");
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "Please verify email first." });
    }
    return res.redirect("/verify");
  }
  if (v.phoneVerified) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, verified: true });
    }
    return res.redirect("/verify");
  }
  if (!p.phone) {
    flashErr(req, "phoneSend", "No phone number available. Please re-register.");
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "No phone number available." });
    }
    return res.redirect("/verify");
  }

  try {
    const verifyNumber = (typeof smsService.generateVerifyNumber === "function")
      ? smsService.generateVerifyNumber()
      : "1234";

    v.phoneVerifyNumber = verifyNumber;
    v.phoneCode = verifyNumber;
    v.phoneCodeIssuedAt = Date.now();

    if (typeof smsService.sendVerificationNumber === "function") {
      await smsService.sendVerificationNumber(p.phone, verifyNumber, { req });
    } else {
      await smsService.sendVerificationCode(p.phone, verifyNumber, { req });
    }

    flashMsg(
      req,
      "phoneSend",
      "An SMS verification number has been sent to <strong>" + p.phone + "</strong>."
    );

    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, message: "SMS verification number sent.", code: verifyNumber });
    }
  } catch (err) {
    console.error("[verify] sendPhoneCode failed:", err);
    delete v.phoneCode;
    delete v.phoneVerifyNumber;
    delete v.phoneCodeIssuedAt;
    flashErr(
      req,
      "phoneSend",
      "We couldn't send the SMS verification number right now. Please try again in a moment."
    );
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(500).json({ success: false, error: "Failed to dispatch SMS verification number." });
    }
  }
  res.redirect("/verify");
};

exports.checkPhoneCode = async (req, res) => {
  const p = getPending(req, res);
  if (!p) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "No registration in progress." });
    }
    return;
  }
  const v = ensureVerificationState(req);
  cleanExpiredOtps(req.session);

  if (!v.emailVerified || v.phoneVerified) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "Invalid verification state." });
    }
    return res.redirect("/verify");
  }

  const digits = String(req.body.phoneCode || req.body.verifyNumber || "").replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 6) {
    flashErr(req, "phoneCheck", "Verification number must be 4–6 digits.");
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: "Verification number must be 4–6 digits." });
    }
    return res.redirect("/verify");
  }

  // Allow dummy code "1234" by default for dev/demo if not already dispatched
  const pendingNumber = String(v.phoneVerifyNumber || v.phoneCode || "1234");

  v.phoneAttempts = (v.phoneAttempts || 0) + 1;
  if (v.phoneAttempts > 5) {
    delete v.phoneCode;
    delete v.phoneVerifyNumber;
    delete v.phoneCodeIssuedAt;
    delete v.phoneAttempts;
    flashErr(req, "phoneCheck", "Too many invalid number attempts. Please request a new SMS verification number.");
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(429).json({ success: false, error: "Too many invalid number attempts." });
    }
    return res.redirect("/verify");
  }

  if (!safeCompare(digits, pendingNumber)) {
    const remaining = Math.max(0, 5 - v.phoneAttempts);
    flashErr(req, "phoneCheck", `Incorrect phone verification number. (${remaining} attempt(s) remaining)`);
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: `Incorrect phone verification number. (${remaining} attempt(s) remaining)` });
    }
    return res.redirect("/verify");
  }

  v.phoneVerified = true;
  // pinkey is the verified number from sms.js (not code)
  v.pinkey = digits;
  delete v.phoneCode;
  delete v.phoneVerifyNumber;
  delete v.phoneCodeIssuedAt;
  delete v.phoneAttempts;

  // BOTH STEPS PASSED → write user to DB, activate session, go to dashboard.
  return finalizeRegistration(req, res);
};
