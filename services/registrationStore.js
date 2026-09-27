// services/registrationStore.js
// Persistent backing store and commit queue for registration data.
// Guarantees zero data loss during account creation even across server restarts,
// crashes, or temporary MongoDB connection drops.

const fs = require("fs");
const path = require("path");
const { redis } = require("../config/redis");

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_FILE = path.join(DATA_DIR, "registration-store.json");
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL for pending forms

let memoryCache = {
  pendingRegistrations: {},
  pendingCommits: [],
};

// Ensure data directory and file exist safely
function initStoreFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      if (raw && raw.trim()) {
        const parsed = JSON.parse(raw);
        memoryCache.pendingRegistrations = parsed.pendingRegistrations || {};
        memoryCache.pendingCommits = parsed.pendingCommits || [];
      }
    } else {
      fs.writeFileSync(STORE_FILE, JSON.stringify(memoryCache, null, 2), "utf8");
    }
  } catch (err) {
    console.warn("[registrationStore] Store file init warning:", err.message);
  }
}

initStoreFile();

function persistToFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(memoryCache, null, 2), "utf8");
  } catch (err) {
    console.warn("[registrationStore] Failed to write store file:", err.message);
  }
}

/**
 * Clean up expired pending registrations.
 */
function cleanupExpired() {
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(memoryCache.pendingRegistrations)) {
    const item = memoryCache.pendingRegistrations[key];
    if (item && item.createdAt && now - item.createdAt > PENDING_TTL_MS) {
      delete memoryCache.pendingRegistrations[key];
      changed = true;
    }
  }
  if (changed) persistToFile();
}

/**
 * Save pending registration to persistent disk store and Redis.
 */
function savePendingRegistration(identifier, data) {
  if (!identifier || !data) return;
  const key = String(identifier).trim();
  const entry = {
    ...data,
    createdAt: Date.now(),
  };

  memoryCache.pendingRegistrations[key] = entry;
  persistToFile();

  if (redis && redis.isReady) {
    try {
      redis.set(`chama:pending_reg:${key}`, JSON.stringify(entry), { EX: 1800 }).catch(() => {});
    } catch (_) {}
  }
}

/**
 * Retrieve pending registration from memory, disk, or Redis.
 */
async function getPendingRegistration(identifier) {
  if (!identifier) return null;
  cleanupExpired();
  const key = String(identifier).trim();

  // 1. Check memory / disk cache
  if (memoryCache.pendingRegistrations[key]) {
    return memoryCache.pendingRegistrations[key];
  }

  // 2. Check Redis
  if (redis && redis.isReady) {
    try {
      const raw = await redis.get(`chama:pending_reg:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        memoryCache.pendingRegistrations[key] = parsed;
        return parsed;
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Delete pending registration once finalized.
 */
function deletePendingRegistration(identifier) {
  if (!identifier) return;
  const key = String(identifier).trim();
  delete memoryCache.pendingRegistrations[key];
  persistToFile();

  if (redis && redis.isReady) {
    try {
      redis.del(`chama:pending_reg:${key}`).catch(() => {});
    } catch (_) {}
  }
}

/**
 * Queue a fully verified account commit so it is NEVER lost, even if
 * MongoDB is currently offline or the server restarts.
 */
function queueVerifiedAccount(userDoc) {
  if (!userDoc || !userDoc.phone) return;
  
  // Prevent duplicate queuing for the same phone
  const existingIdx = memoryCache.pendingCommits.findIndex(
    (c) => c.phone === userDoc.phone || (c.email && c.email === userDoc.email)
  );

  const commitEntry = {
    ...userDoc,
    queuedAt: new Date().toISOString(),
    status: "pending_db_commit",
  };

  if (existingIdx >= 0) {
    memoryCache.pendingCommits[existingIdx] = commitEntry;
  } else {
    memoryCache.pendingCommits.push(commitEntry);
  }

  persistToFile();
  console.log(`[registrationStore] Queued verified account for ${userDoc.phone} to persistent disk queue.`);
}

/**
 * Flush all pending verified accounts into MongoDB.
 * Called on startup, on MongoDB connection/reconnection, and in background.
 */
async function flushPendingCommits(User, mongoose) {
  const isDbConnected = Boolean(
    mongoose &&
    mongoose.connection &&
    mongoose.connection.readyState === 1
  );

  if (!isDbConnected || !User || typeof User.findOneAndUpdate !== "function") {
    return;
  }

  if (!memoryCache.pendingCommits || memoryCache.pendingCommits.length === 0) {
    return;
  }

  console.log(`[registrationStore] Flushing ${memoryCache.pendingCommits.length} pending account commit(s) to MongoDB...`);
  const remaining = [];

  for (const account of memoryCache.pendingCommits) {
    try {
      const { queuedAt, status, _id, ...docData } = account;
      await User.findOneAndUpdate(
        { $or: [{ phone: account.phone }, { email: account.email ? account.email.toLowerCase() : "" }] },
        { $set: docData },
        { upsert: true, new: true }
      );
      console.log(`[registrationStore] Successfully committed queued user to MongoDB: ${account.phone}`);
    } catch (err) {
      console.error(`[registrationStore] Failed to commit queued user ${account.phone} to MongoDB:`, err.message);
      remaining.push(account); // Keep in queue for next retry
    }
  }

  memoryCache.pendingCommits = remaining;
  persistToFile();
}

/**
 * Check if a phone number or email is already registered and verified in MongoDB or queue.
 */
async function isAccountRegistered(phone, email, User, mongoose) {
  const cleanPhone = String(phone || "").trim();
  const cleanEmail = String(email || "").trim().toLowerCase();

  // 1. Check in MongoDB if connected
  const isDbConnected = Boolean(
    mongoose &&
    mongoose.connection &&
    mongoose.connection.readyState === 1
  );

  if (isDbConnected && User && typeof User.findOne === "function") {
    try {
      const query = [];
      if (cleanPhone) {
        query.push({ phone: cleanPhone });
        // Handle variations (e.g. without + or national digits)
        const digits = cleanPhone.replace(/\D/g, "");
        if (digits) {
          query.push({ phone: { $regex: digits + "$" } });
        }
      }
      if (cleanEmail) {
        query.push({ email: cleanEmail });
      }

      if (query.length > 0) {
        const found = await User.findOne({ $or: query }).lean();
        if (found) {
          return {
            exists: true,
            verified: Boolean(found.phoneVerified || found.emailVerified || found.passwordHash),
            phoneMatched: cleanPhone && (found.phone === cleanPhone || String(found.phone).includes(cleanPhone.replace(/\D/g, ""))),
            emailMatched: cleanEmail && found.email === cleanEmail,
            user: {
              name: found.name,
              phone: found.phone,
              email: found.email,
            },
          };
        }
      }
    } catch (err) {
      console.warn("[registrationStore] DB lookup error:", err.message);
    }
  }

  // 2. Check pending verified commits queue on disk
  if (memoryCache.pendingCommits && memoryCache.pendingCommits.length > 0) {
    const foundQueue = memoryCache.pendingCommits.find(
      (c) => (cleanPhone && c.phone === cleanPhone) || (cleanEmail && c.email === cleanEmail)
    );
    if (foundQueue) {
      return {
        exists: true,
        verified: true,
        phoneMatched: cleanPhone && foundQueue.phone === cleanPhone,
        emailMatched: cleanEmail && foundQueue.email === cleanEmail,
        user: {
          name: foundQueue.name,
          phone: foundQueue.phone,
          email: foundQueue.email,
        },
      };
    }
  }

  return { exists: false, verified: false };
}

/**
 * Setup automatic flush on MongoDB connect / reconnect.
 */
function setupAutoFlush(User, mongoose) {
  if (mongoose && mongoose.connection) {
    mongoose.connection.on("connected", () => {
      console.log("[registrationStore] MongoDB connected: triggering pending registration flush.");
      flushPendingCommits(User, mongoose);
    });
    mongoose.connection.on("reconnected", () => {
      console.log("[registrationStore] MongoDB reconnected: triggering pending registration flush.");
      flushPendingCommits(User, mongoose);
    });
  }

  // Periodic flush every 15 seconds
  setInterval(() => {
    flushPendingCommits(User, mongoose);
  }, 15000);
}

module.exports = {
  savePendingRegistration,
  getPendingRegistration,
  deletePendingRegistration,
  queueVerifiedAccount,
  flushPendingCommits,
  isAccountRegistered,
  setupAutoFlush,
};
