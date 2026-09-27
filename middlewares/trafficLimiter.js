// middlewares/trafficLimiter.js
// Anti-flooding & traffic management module for the Chama application.
//
// Protects sensitive authentication workflows (login, registration, OTPs)
// against brute-force attacks, credential stuffing, and SMS/Email flooding.
//
// Dual-mode operation:
//   1. Uses Redis (atomic INCR + EXPIRE) when available (production & clustered nodes).
//   2. Seamlessly falls back to a self-pruning in-memory store when Redis is offline (local dev).

const { redis } = require("../config/redis");

/* -------------------------------------------------------------------------- */
/*                        IN-MEMORY FALLBACK STORE                            */
/* -------------------------------------------------------------------------- */
const memoryStore = new Map();

// Periodic cleanup every 2 minutes to prevent memory leaks in dev mode
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (now > entry.resetTime) {
      memoryStore.delete(key);
    }
  }
}, 2 * 60 * 1000).unref();

/* -------------------------------------------------------------------------- */
/*                       RATE LIMIT RECORD MANAGER                            */
/* -------------------------------------------------------------------------- */
async function hitLimit(key, windowMs, max) {
  const windowSec = Math.ceil(windowMs / 1000);

  // 1. Redis Mode
  if (redis && redis.isReady) {
    try {
      const redisKey = `ratelimit:${key}`;
      const hits = await redis.incr(redisKey);
      if (hits === 1) {
        await redis.expire(redisKey, windowSec);
      }
      const ttl = await redis.ttl(redisKey);
      return {
        totalHits: hits,
        resetTime: Date.now() + Math.max(ttl, 1) * 1000,
        exceeded: hits > max,
      };
    } catch (err) {
      console.warn("[trafficLimiter] Redis failure; falling back to memory:", err.message);
    }
  }

  // 2. In-Memory Mode
  const now = Date.now();
  let record = memoryStore.get(key);

  if (!record || now > record.resetTime) {
    record = { hits: 1, resetTime: now + windowMs };
    memoryStore.set(key, record);
    return {
      totalHits: 1,
      resetTime: record.resetTime,
      exceeded: false,
    };
  }

  record.hits += 1;
  return {
    totalHits: record.hits,
    resetTime: record.resetTime,
    exceeded: record.hits > max,
  };
}

/* -------------------------------------------------------------------------- */
/*                     FACTORY: CREATE CUSTOM LIMITER                         */
/* -------------------------------------------------------------------------- */
function createLimiter({
  prefix = "general",
  windowMs = 60 * 1000,
  max = 60,
  keyGenerator,
  onLimitExceeded,
}) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const clientIp =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket.remoteAddress ||
        "127.0.0.1";

      const dynamicPart = keyGenerator ? keyGenerator(req) : clientIp;
      const key = `${prefix}:${dynamicPart}`;

      const { totalHits, resetTime, exceeded } = await hitLimit(key, windowMs, max);

      const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, max - totalHits));
      res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000));

      if (exceeded) {
        res.setHeader("Retry-After", retryAfterSeconds);
        console.warn(`[trafficLimiter] Flood blocked: ${key} (${totalHits}/${max} hits)`);
        if (typeof onLimitExceeded === "function") {
          return onLimitExceeded(req, res, retryAfterSeconds);
        }
        return res.status(429).send("Too many requests. Please try again later.");
      }

      next();
    } catch (err) {
      console.error("[trafficLimiter] Error evaluating rate limit:", err);
      // In case of error, fail open so user traffic is not abruptly broken
      next();
    }
  };
}

/* -------------------------------------------------------------------------- */
/*            PRE-CONFIGURED DATA BLOCKS FOR CHAMA AUTH WORKFLOW              */
/* -------------------------------------------------------------------------- */

/**
 * 1. Login Traffic Block (login.hbs - POST /login)
 * Protects against brute-force password guessing & CPU exhaustion from bcrypt.
 * Limit: 5 failed/repeated attempts per 10 minutes per IP + Email.
 */
const loginBlock = createLimiter({
  prefix: "auth:login",
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  keyGenerator: (req) => {
    const ip = req.socket.remoteAddress || "ip";
    const identifier = (req.body.phone || req.body.email || "").toString().trim().toLowerCase();
    return `${ip}:${identifier || "anonymous"}`;
  },
  onLimitExceeded: (req, res, retryAfter) => {
    const minutes = Math.ceil(retryAfter / 60);
    const msg = `Too many login attempts. For security, please wait ${minutes} minute(s) before trying again.`;
    return res.status(429).render("login", {
      title: "Login",
      isRegister: false,
      errors: {
        phone: msg,
        email: msg,
      },
      formData: {
        phone: req.body.phone,
        countryCode: req.body.countryCode || "+254",
        email: req.body.email,
      },
    });
  },
});

/**
 * 2. Registration Traffic Block (login.hbs - POST /register)
 * Prevents automated account creation spam & session store bloat.
 * Limit: 5 registration submissions per 30 minutes per IP.
 */
const registerBlock = createLimiter({
  prefix: "auth:register",
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 5,
  keyGenerator: (req) => req.socket.remoteAddress || "ip",
  onLimitExceeded: (req, res, retryAfter) => {
    const minutes = Math.ceil(retryAfter / 60);
    return res.status(429).render("login", {
      title: "Register",
      isRegister: true,
      errors: {
        name: `Too many accounts registered from this connection. Please wait ${minutes} minute(s).`,
      },
      formData: {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        countryCode: req.body.countryCode,
      },
    });
  },
});

// 3. OTP Dispatch Block (verify.hbs - POST /verify/:channel/send)
// Protects SMS & Email gateways from costly flooding while distinguishing channels.
const otpSendBlock = createLimiter({
  prefix: "otp:send",
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator: (req) => {
    const channel = req.path.includes("phone") ? "phone" : "email";
    const pending = req.session?.pendingRegistration;
    const identifier = channel === "phone"
      ? (pending?.phone || req.socket.remoteAddress || "guest")
      : (pending?.email || req.socket.remoteAddress || "guest");
    return `${channel}:${identifier}`;
  },
  onLimitExceeded: (req, res, retryAfter) => {
    if (req.flash) {
      req.flash("errors", {
        workflow: `Please wait ${retryAfter} second(s) before requesting another code.`,
      });
    }
    return res.redirect("/verify");
  },
});

// 4. OTP Guessing Block (verify.hbs - POST /verify/:channel/check)
// Prevents OTP code brute-forcing.
// Limit: 8 attempts per 10 minutes per channel.
const otpCheckBlock = createLimiter({
  prefix: "otp:check",
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 8,
  keyGenerator: (req) => {
    const channel = req.path.includes("phone") ? "phone" : "email";
    const pending = req.session?.pendingRegistration;
    const identifier = channel === "phone"
      ? (pending?.phone || req.socket.remoteAddress || "guest")
      : (pending?.email || req.socket.remoteAddress || "guest");
    return `${channel}:${identifier}`;
  },
  onLimitExceeded: (req, res, retryAfter) => {
    const minutes = Math.ceil(retryAfter / 60);
    if (req.flash) {
      req.flash("errors", {
        workflow: `Too many invalid attempts. Verification locked for ${minutes} minute(s).`,
      });
    }
    return res.redirect("/verify");
  },
});

/**
 * 5. Forgot PIN Code Dispatch Block (POST /forgot-pin/send)
 * Protects SMS OTP gateway against abuse. Max 1 request per 60s cooldown.
 */
const forgotPinSendBlock = createLimiter({
  prefix: "forgot:send",
  windowMs: 60 * 1000,
  max: 1,
  keyGenerator: (req) => {
    const phone = (req.body.phone || "").toString().trim();
    const ip = req.socket.remoteAddress || "ip";
    return `${ip}:${phone || "guest"}`;
  },
  onLimitExceeded: (req, res, retryAfter) => {
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(429).json({
        success: false,
        error: `Please wait ${retryAfter} second(s) before requesting another passcode.`,
      });
    }
    if (req.flash) {
      req.flash("errors", {
        forgotPin: `Please wait ${retryAfter} second(s) before requesting another passcode.`,
      });
    }
    return res.redirect("/login");
  },
});

/**
 * 6. Forgot PIN Code Guessing Block (POST /forgot-pin/verify)
 * Prevents 6-digit passcode brute-forcing. Limit: 5 attempts per 10 minutes.
 */
const forgotPinVerifyBlock = createLimiter({
  prefix: "forgot:verify",
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const phone = (req.session?.forgotPin?.phone || req.body.phone || "").toString().trim();
    const ip = req.socket.remoteAddress || "ip";
    return `${ip}:${phone || "guest"}`;
  },
  onLimitExceeded: (req, res, retryAfter) => {
    const minutes = Math.ceil(retryAfter / 60);
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(429).json({
        success: false,
        error: `Too many invalid attempts. Passcode verification locked for ${minutes} minute(s).`,
      });
    }
    if (req.flash) {
      req.flash("errors", {
        forgotPin: `Too many invalid attempts. Passcode verification locked for ${minutes} minute(s).`,
      });
    }
    return res.redirect("/login");
  },
});

module.exports = {
  createLimiter,
  loginBlock,
  registerBlock,
  otpSendBlock,
  otpCheckBlock,
  forgotPinSendBlock,
  forgotPinVerifyBlock,
};
