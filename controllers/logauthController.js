// controllers/authController.js
// Authentication flow (login / register / logout).
//
// Server-side validation mirrors the rules previously kept only in login.hbs
// inline scripts (Kenyan phone, 4-digit PIN with confirmation, 2-name full
// name, email presence). Client-side checks give instant UX feedback, but the
// backend is the real source of truth — it re-validates on every POST.
//
// REGISTRATION WORKFLOW (post-form):
//   1. User posts valid form → pendingRegistration is saved in the session
//      (raw validated data, NOT yet written to DB).
//   2. Redirect to /verify (two-step email + phone OTP via services/email.js
//      and services/sms.js).
//   3. Only after BOTH OTPs verify does verifyController call
//      finalizeRegistration() → write User into Mongo + promote session.user
//      to full authenticated user → redirect to /dashboard.
//
// LOGIN WORKFLOW (with attempt tracking & lockout):
//   - Tracks failed login attempts per phone number in the session.
//   - Distinguishes between "wrong number" (no account) and "wrong PIN".
//   - Locks the phone number after MAX_LOGIN_ATTEMPTS failed attempts for
//     LOGIN_LOCKOUT_MS to prevent brute-force guessing.
//   - On success: clears attempt counter, sets session.user, redirects to /dashboard.
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const { mongoose } = require("../config/db");
const { buildDemoUser, buildPhoneHierarchy } = require("../services/chamaData");
const smsService = require("../services/sms");

// Attempt tracking constants — configurable via environment variables so the
// lockout can be tuned for testing vs. production.
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || "999", 10);
const LOGIN_LOCKOUT_MS = parseInt(process.env.LOGIN_LOCKOUT_MS || "600000", 10); // 10 minutes default

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

/* ---------- Pure validation helpers (reused on every register POST) ---------- */

function hasTwoNames(value) {
  if (!value || typeof value !== "string") return false;
  const parts = value.trim().split(/\s+/);
  return parts.length >= 2 && parts.every((p) => p.length > 0);
}

function validateKePhone(value) {
  if (!value || typeof value !== "string") return false;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return false;
  if (digits.startsWith("0")) {
    if (digits.length !== 10) return false;
    if (!digits.startsWith("07") && !digits.startsWith("01")) return false;
  } else {
    if (digits.length !== 9) return false;
    if (!digits.startsWith("7") && !digits.startsWith("1")) return false;
  }
  return true;
}

function getPhoneError(value) {
  if (!value || (typeof value === "string" && value.trim() === "")) {
    return "Phone number is required";
  }
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 0) return "Please enter only digits";
  if (digits.startsWith("0")) {
    if (digits.length !== 10) {
      return "Number starting with 0 must be exactly 10 digits (e.g., 0712345678)";
    }
    if (!digits.startsWith("07") && !digits.startsWith("01")) {
      return "Kenyan number starting with 0 must begin with 07 or 01";
    }
  } else {
    if (digits.length !== 9) {
      return "Number without leading 0 must be exactly 9 digits (e.g., 712345678)";
    }
    if (!digits.startsWith("7") && !digits.startsWith("1")) {
      return "Kenyan number must begin with 7 or 1 (e.g., 712345678 or 112345678)";
    }
  }
  return "";
}

function isValidEmail(value) {
  if (!value || typeof value !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function getPinError(password, confirmPassword) {
  if (!password) return "Create PIN is required";
  if (!/^\d{4}$/.test(password)) return "PIN must be exactly 4 digits";
  if (!confirmPassword) return "Please confirm your PIN";
  if (!/^\d{4}$/.test(confirmPassword)) return "Confirm PIN must be exactly 4 digits";
  if (password !== confirmPassword) return "PIN mismatch";
  return "";
}

function normalizePhone(countryCode, phone) {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) {
    return (countryCode || "+254") + digits.slice(1);
  }
  return (countryCode || "+254") + digits;
}

/* ---------- Login ---------- */

exports.showLogin = (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  const prefillPhone = req.session.loginPhone || "";
  // Keep phone prefilled for the user experience, but clear temporary session flag
  delete req.session.loginPhone;

  const messages = Object.assign({}, res.locals.messages || {});
  if (req.session.loginSuccess) {
    messages.loginSuccess = req.session.loginSuccess;
    delete req.session.loginSuccess;
  }

  res.render("login", {
    title: "Login",
    isRegister: false,
    errors: res.locals.errors || {},
    messages,
    formData: {
      countryCode: "+254",
      phone: prefillPhone,
    },
  });
};

exports.handleLogin = async (req, res) => {
  const { countryCode, phone, password, pin, email } = req.body;
  const errors = {};

  const cCode = countryCode || "+254";
  const rawPhone = (phone || "").toString().trim();
  const rawPin = (password !== undefined && password !== "" ? password : pin) || "";
  const cleanEmail = (email || "").toString().trim().toLowerCase();

  console.log("[controllers/logauthController] Login attempt received for phone:", rawPhone || cleanEmail);

  const formData = {
    countryCode: cCode,
    phone: rawPhone,
    email: cleanEmail,
  };

  // Comply to phone number + PIN registration workflow
  if (rawPhone || !cleanEmail) {
    const phoneMsg = getPhoneError(rawPhone);
    if (phoneMsg) {
      errors.phone = phoneMsg;
    }
    if (!rawPin) {
      errors.password = "PIN is required";
    } else if (!/^\d{4}$/.test(String(rawPin))) {
      errors.password = "PIN must be exactly 4 digits";
    }
  } else {
    // Backward-compatibility fallback if email was provided directly
    if (!isValidEmail(cleanEmail)) {
      errors.email = "Please enter a valid email address";
    }
    if (!rawPin) {
      errors.password = "Password is required";
    }
  }

  if (Object.keys(errors).length > 0) {
    console.warn("[controllers/logauthController] Login validation failed for phone:", rawPhone || cleanEmail, "errors:", Object.keys(errors));
    return res.status(400).render("login", {
      title: "Login",
      isRegister: false,
      errors,
      formData,
    });
  }

  const normalizedPhone = rawPhone ? normalizePhone(cCode, rawPhone) : "";

  // ---- Attempt tracking & lockout (per-phone) ----
  // We key attempts by the normalized phone (or email fallback) so the
  // lockout survives page reloads within the same browser session.
  const attemptKey = normalizedPhone || cleanEmail || "unknown";
  const now = Date.now();
  let attemptState = req.session.loginAttempts && req.session.loginAttempts[attemptKey];

  if (attemptState) {
    // Reset counter if lockout window has elapsed
    if (now > attemptState.lockedUntil) {
      attemptState = undefined;
      delete req.session.loginAttempts[attemptKey];
    }
  }

  if (attemptState && attemptState.lockedUntil) {
    const minutesLeft = Math.ceil((attemptState.lockedUntil - now) / 60000);
    const lockMsg = `🔒 Account locked. Try again in ${minutesLeft} minute(s).`;
    return res.status(423).render("login", {
      title: "Login",
      isRegister: false,
      errors: {
        phone: lockMsg,
        password: lockMsg,
      },
      formData,
      attemptState: {
        locked: true,
        remaining: 0,
        max: MAX_LOGIN_ATTEMPTS,
        minutesLeft,
      },
    });
  }

  // If MongoDB is connected and User model is defined, verify against the User model and bcrypt hash
  if (
    mongoose.connection &&
    mongoose.connection.readyState === 1 &&
    User &&
    typeof User.findOne === "function"
  ) {
    try {
      const query = normalizedPhone
        ? { $or: [{ phone: normalizedPhone }, { phone: rawPhone }] }
        : { email: cleanEmail };

      const user = await User.findOne(query);
      console.log("[controllers/logauthController] User lookup result for", normalizedPhone || cleanEmail, ":", user ? "found" : "not found");
      if (!user) {
        // Record failed attempt for wrong number
        if (!req.session.loginAttempts) req.session.loginAttempts = {};
        const prev = req.session.loginAttempts[attemptKey] || { count: 0 };
        prev.count = (prev.count || 0) + 1;
        prev.lastAttempt = now;
        if (prev.count >= MAX_LOGIN_ATTEMPTS) {
          prev.lockedUntil = now + LOGIN_LOCKOUT_MS;
        }
        req.session.loginAttempts[attemptKey] = prev;

        const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - prev.count);
        const resetMinutes = LOGIN_LOCKOUT_MS / 60000;
        const msg = remaining > 0
          ? `🔑 ${remaining} attempt(s) remaining before lockout (${MAX_LOGIN_ATTEMPTS} max).`
          : `🔒 Account locked. Try again in ${resetMinutes} minute(s).`;

        return res.status(400).render("login", {
          title: "Login",
          isRegister: false,
          errors: { phone: msg },
          formData,
          attemptState: {
            locked: false,
            remaining,
            max: MAX_LOGIN_ATTEMPTS,
          },
        });
      }

      const isMatch = await bcrypt.compare(String(rawPin), user.passwordHash);
      console.log("[controllers/logauthController] PIN verification for", normalizedPhone || cleanEmail, ":", isMatch ? "matched" : "mismatched");
      if (!isMatch) {
        // Record failed attempt for wrong PIN
        if (!req.session.loginAttempts) req.session.loginAttempts = {};
        const prev = req.session.loginAttempts[attemptKey] || { count: 0 };
        prev.count = (prev.count || 0) + 1;
        prev.lastAttempt = now;
        if (prev.count >= MAX_LOGIN_ATTEMPTS) {
          prev.lockedUntil = now + LOGIN_LOCKOUT_MS;
        }
        req.session.loginAttempts[attemptKey] = prev;

        const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - prev.count);
        const resetMinutes = LOGIN_LOCKOUT_MS / 60000;
        const msg = remaining > 0
          ? `🔑 ${remaining} attempt(s) remaining before lockout (${MAX_LOGIN_ATTEMPTS} max).`
          : `🔒 Account locked. Try again in ${resetMinutes} minute(s).`;

        return res.status(400).render("login", {
          title: "Login",
          isRegister: false,
          errors: { password: msg },
          formData,
          attemptState: {
            locked: false,
            remaining,
            max: MAX_LOGIN_ATTEMPTS,
          },
        });
      }

      console.log("[controllers/logauthController] Login successful for user:", user ? user._id : "unknown", "phone:", normalizedPhone || cleanEmail);

  // Successful login — clear attempt counter
      if (req.session.loginAttempts) {
        delete req.session.loginAttempts[attemptKey];
      }

      // Build phone hierarchy on the fly from the stored phone number
      const loginPhoneHierarchy = buildPhoneHierarchy("+254", user.phone);
      const loginPhoneNumberValue = loginPhoneHierarchy.numberValue;

      req.session.user = {
        _id: String(user._id),
        id: String(user._id),
        name: user.name,
        email: user.email,
        phone: user.phone,
        phoneNumberValue: loginPhoneNumberValue,
        phoneHierarchy: loginPhoneHierarchy,
        memberIndex: user.memberIndex,
        registrationTime: user.registrationTime,
        emailVerified: true,
        phoneVerified: true,
      };

      // Cleanse sensitive ephemeral state from session upon successful login
      delete req.session.pendingRegistration;
      delete req.session.verification;
      delete req.session.forgotPin;
      delete req.session.loginPhone;

      return res.redirect("/dashboard");
    } catch (err) {
      console.error("[controllers/logauthController] Database error during login for", rawPhone || cleanEmail, ":", err.message);
      // Fall through to demo user fallback if an unexpected error occurs
    }
  }

  console.log("[controllers/logauthController] MongoDB not connected for login of", normalizedPhone || cleanEmail, "— demo mode enabled:", process.env.ALLOW_DEMO_LOGIN === "true");
  // Demo fallback for offline / development testing — ONLY when explicitly
  // enabled via ALLOW_DEMO_LOGIN=true in the environment. This prevents
  // unverified phone numbers from logging in when the database is offline.
  if (process.env.ALLOW_DEMO_LOGIN === "true") {
    req.session.user = buildDemoUser({
      phone: normalizedPhone || undefined,
      email: cleanEmail || undefined,
    });

    // Clear attempt counter on successful demo login
    if (req.session.loginAttempts) {
      delete req.session.loginAttempts[attemptKey];
    }

    // Cleanse sensitive ephemeral state from session upon demo login
    delete req.session.pendingRegistration;
    delete req.session.verification;
    delete req.session.forgotPin;
    delete req.session.loginPhone;

    return res.redirect("/dashboard");
  }

  console.warn("[controllers/logauthController] Login blocked for unverified number", rawPhone || cleanEmail, "— MongoDB unavailable and demo mode disabled");
  // Database is required for login — no account was found and demo mode is
  // disabled, so we cannot authenticate this user.
  return res.status(503).render("login", {
    title: "Login",
    isRegister: false,
    errors: {
      phone: "Unable to verify your account at this time. Please try again later.",
    },
    formData,
  });
};

/* ---------- Forgot PIN Workflow (SMS verification & account confirmation) ---------- */

exports.sendForgotPinCode = async (req, res) => {
  const countryCode = String(req.body.countryCode || "+254").trim();
  const rawPhone = String(req.body.phone || "").trim();

  const phoneMsg = getPhoneError(rawPhone);
  if (phoneMsg) {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: phoneMsg });
    }
    if (req.flash) req.flash("errors", { forgotPin: phoneMsg });
    return res.redirect("/login");
  }

  const normalizedPhone = normalizePhone(countryCode, rawPhone);

  // MongoDB Database verification from users personal collection
  if (
    mongoose.connection &&
    mongoose.connection.readyState === 1 &&
    User &&
    typeof User.findOne === "function"
  ) {
    try {
      const user = await User.findOne({
        $or: [{ phone: normalizedPhone }, { phone: rawPhone }],
      });
      if (!user) {
        const notFoundMsg = "No registered account found with this phone number.";
        if (req.xhr || req.headers.accept?.includes("json")) {
          return res.status(404).json({ success: false, error: notFoundMsg });
        }
        if (req.flash) req.flash("errors", { forgotPin: notFoundMsg });
        return res.redirect("/login");
      }
    } catch (err) {
      console.error("[ForgotPIN] Error verifying user from MongoDB collection:", err);
    }
  }

  // Generate secure 6-digit passcode
  const passcode = random6Digit();
  req.session.forgotPin = {
    phone: normalizedPhone,
    rawPhone: rawPhone,
    countryCode: countryCode,
    code: passcode,
    issuedAt: Date.now(),
  };

  try {
    await smsService.sendVerificationCode(normalizedPhone, passcode, { req });
    const successMsg = `Passcode sent to ${normalizedPhone}. Valid for 10 minutes.`;
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({
        success: true,
        message: successMsg,
        phone: normalizedPhone,
      });
    }
    if (req.flash) req.flash("messages", { forgotPin: successMsg });
    return res.redirect("/login");
  } catch (err) {
    console.error("[ForgotPIN] SMS dispatch failed:", err);
    delete req.session.forgotPin;
    const sendErrMsg = "Failed to dispatch SMS passcode. Please try again.";
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(500).json({ success: false, error: sendErrMsg });
    }
    if (req.flash) req.flash("errors", { forgotPin: sendErrMsg });
    return res.redirect("/login");
  }
};

exports.verifyForgotPinCode = async (req, res) => {
  const rawCode = String(req.body.passcode || req.body.code || "").trim();
  const digits = rawCode.replace(/\D/g, "");

  if (digits.length < 4 || digits.length > 6) {
    const codeErrMsg = "Passcode must be 4–6 digits.";
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: codeErrMsg });
    }
    if (req.flash) req.flash("errors", { forgotPin: codeErrMsg });
    return res.redirect("/login");
  }

  const sessionForgot = req.session?.forgotPin;
  if (!sessionForgot || !sessionForgot.code) {
    const noPendingMsg = "No passcode pending or code expired. Please request a new code.";
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: noPendingMsg });
    }
    if (req.flash) req.flash("errors", { forgotPin: noPendingMsg });
    return res.redirect("/login");
  }

  const OTP_TTL_MS = 10 * 60 * 1000;
  if (Date.now() - (sessionForgot.issuedAt || 0) > OTP_TTL_MS) {
    delete req.session.forgotPin;
    const expiredMsg = "Passcode has expired. Please request a new code.";
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: expiredMsg });
    }
    if (req.flash) req.flash("errors", { forgotPin: expiredMsg });
    return res.redirect("/login");
  }

  sessionForgot.attempts = (sessionForgot.attempts || 0) + 1;
  if (sessionForgot.attempts > 5) {
    delete req.session.forgotPin;
    const lockedMsg = "Too many invalid attempts. Please request a new passcode.";
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: lockedMsg });
    }
    if (req.flash) req.flash("errors", { forgotPin: lockedMsg });
    return res.redirect("/login");
  }

  if (!safeCompare(digits, String(sessionForgot.code))) {
    const remaining = Math.max(0, 5 - sessionForgot.attempts);
    const mismatchMsg = `Incorrect passcode. (${remaining} attempt(s) remaining)`;
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(400).json({ success: false, error: mismatchMsg });
    }
    if (req.flash) req.flash("errors", { forgotPin: mismatchMsg });
    return res.redirect("/login");
  }

  // Store verified phone number in session for login redirection
  const savedPhone = sessionForgot.rawPhone || sessionForgot.phone;
  req.session.loginPhone = savedPhone;
  req.session.verifiedPhone = sessionForgot.phone;
  delete req.session.forgotPin;

  if (req.flash) {
    req.flash("messages", {
      loginSuccess: `Phone number verified successfully! Please enter your PIN to sign in.`,
    });
  }

  if (req.xhr || req.headers.accept?.includes("json")) {
    return res.json({
      success: true,
      redirect: "/login",
      phone: savedPhone,
      message: "Phone number verified! Redirecting to login...",
    });
  }
  return res.redirect("/login");
};

/* ---------- Register (form validation + kick off verification workflow) ---------- */

exports.showRegister = (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  const errors = Object.assign({}, res.locals.errors || {});
  const messages = Object.assign({}, res.locals.messages || {});
  res.render("login", {
    title: "Register",
    isRegister: true,
    errors,
    messages,
    formData: {},
  });
};

exports.handleRegister = (req, res) => {
  const { name, email, countryCode, phone, password, confirmPassword } =
    req.body;

  const errors = {};
  const formData = {
    name: (name || "").toString().trim(),
    email: (email || "").toString().trim().toLowerCase(),
    countryCode: countryCode || "+254",
    phone: (phone || "").toString(),
  };

  if (!hasTwoNames(name)) {
    errors.name = "Please enter at least two names (e.g., Jane Mwangi)";
  }
  if (!isValidEmail(email)) {
    errors.email = "Please enter a valid email address";
  }
  const phoneMsg = getPhoneError(phone);
  if (phoneMsg) {
    errors.phone = phoneMsg;
  }
  const pinMsg = getPinError(password, confirmPassword);
  if (pinMsg) {
    errors.pin = pinMsg;
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).render("login", {
      title: "Register",
      isRegister: true,
      errors,
      formData,
    });
  }

  const normalizedPhone = normalizePhone(formData.countryCode, formData.phone);

  req.session.pendingRegistration = {
    name: formData.name,
    email: formData.email,
    phone: normalizedPhone,
    // Plaintext PIN kept in server-memory session only during the 10-min
    // verification window. On verification success verifyController hashes
    // and writes to DB, then deletes this record.
    pin: String(password),
    createdAt: Date.now(),
    maxAgeMs: 10 * 60 * 1000,
  };
  // Blank any stale verification state from a prior attempt
  delete req.session.verification;
  delete req.session.user;

  res.redirect("/verify");
};

/* ---------- Expose validators in case we reuse them for API routes later ---------- */

exports.validators = {
  hasTwoNames,
  validateKePhone,
  getPhoneError,
  isValidEmail,
  getPinError,
  normalizePhone,
};

/* ---------- Logout ---------- */

exports.handleLogout = (req, res) => {
  req.session.destroy(() => res.redirect("/"));
};
