// tests/testViewer.js
// Express router for aggregating and displaying live database, Redis,
// and session data structures at /test via test.hbs.

const express = require("express");
const router = express.Router();
const { mongoose } = require("../config/db");
const { redis } = require("../config/redis");

/**
 * Aggregates all live data from MongoDB, Redis, session, and server environment.
 */
async function gatherSystemData(req) {
  // ----------------------------------------------------
  // 1. MongoDB Database Inspection
  // ----------------------------------------------------
  const dbStateMap = {
    0: "Disconnected",
    1: "Connected",
    2: "Connecting",
    3: "Disconnecting",
  };
  const readyState = mongoose.connection ? mongoose.connection.readyState : 0;
  const isMongoConnected = readyState === 1;

  const mongoData = {
    status: dbStateMap[readyState] || "Unknown",
    connected: isMongoConnected,
    host: mongoose.connection?.host || "N/A",
    port: mongoose.connection?.port || "N/A",
    databaseName: mongoose.connection?.name || "N/A",
    registeredModels: mongoose.modelNames ? mongoose.modelNames() : [],
    collections: [],
  };

  if (isMongoConnected && mongoose.connection.db) {
    try {
      const collections = await mongoose.connection.db.listCollections().toArray();
      for (const col of collections) {
        try {
          const collectionRef = mongoose.connection.db.collection(col.name);
          const count = await collectionRef.countDocuments();
          const sampleDocs = await collectionRef.find().limit(10).toArray();

          // Sanitize password hashes for security
          const sanitizedDocs = sampleDocs.map((doc) => {
            const copy = { ...doc };
            if (copy.passwordHash) copy.passwordHash = "[HASHED / PROTECTED]";
            if (copy.pin) copy.pin = "[PROTECTED]";
            if (copy.pinkey) copy.pinkey = "[PROTECTED]";
            return copy;
          });

          mongoData.collections.push({
            name: col.name,
            documentCount: count,
            sampleDocuments: sanitizedDocs,
          });
        } catch (colErr) {
          mongoData.collections.push({
            name: col.name,
            documentCount: "Error",
            error: colErr.message,
            sampleDocuments: [],
          });
        }
      }
    } catch (err) {
      mongoData.error = err.message;
    }
  }

  // ----------------------------------------------------
  // 2. Redis & Session Inspection
  // ----------------------------------------------------
  const isRedisConnected = Boolean(redis && redis.isReady);
  const redisKeys = [];

  if (isRedisConnected) {
    try {
      const keys = await redis.keys("*");
      for (const key of keys.slice(0, 50)) {
        try {
          const type = await redis.type(key);
          const ttl = await redis.ttl(key);
          let value = null;
          if (type === "string") {
            const rawVal = await redis.get(key);
            try {
              value = JSON.parse(rawVal);
            } catch {
              value = rawVal;
            }
          }
          redisKeys.push({ key, type, ttl, value });
        } catch (kErr) {
          redisKeys.push({ key, error: kErr.message });
        }
      }
    } catch (err) {
      console.warn("[testViewer] Failed to scan Redis keys:", err.message);
    }
  }

  const sessionData = {
    sessionID: req.sessionID || "N/A",
    cookie: req.session?.cookie || {},
    user: req.session?.user || null,
    pendingRegistration: req.session?.pendingRegistration || null,
    verification: req.session?.verification || null,
    fullSessionContent: req.session || {},
  };

  const redisData = {
    status: isRedisConnected ? "Connected" : "Disconnected (In-Memory Fallback Active)",
    connected: isRedisConnected,
    clientUrl: process.env.REDIS_URL ? "Configured in .env" : "Default Localhost",
    totalScannedKeys: redisKeys.length,
    keys: redisKeys,
  };

  // ----------------------------------------------------
  // 3. System & Runtime Environment
  // ----------------------------------------------------
  const memUsage = process.memoryUsage();
  const systemData = {
    nodeVersion: process.version,
    platform: process.platform,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMB: {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    },
    env: {
      NODE_ENV: process.env.NODE_ENV || "development",
      PORT: process.env.PORT || 3000,
      hasMongoUri: Boolean(process.env.MONGODB_URI),
      hasRedisUrl: Boolean(process.env.REDIS_URL),
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
    },
  };

const { runSecurityAudit } = require("./securityAudit");

  return {
    timestamp: new Date().toISOString(),
    clientIp: req.ip || req.socket.remoteAddress || "127.0.0.1",
    mongo: mongoData,
    redis: redisData,
    session: sessionData,
    system: systemData,
    security: runSecurityAudit(),
  };
}

/**
 * Route handler: GET /test
 */
router.get("/test", async (req, res) => {
  try {
    const data = await gatherSystemData(req);

    // If client requested raw JSON via query param ?format=json
    if (req.query.format === "json") {
      return res.json(data);
    }

    res.render("test", {
      title: "System & Data Structure Inspector",
      data,
      jsonData: JSON.stringify(data, null, 2),
    });
  } catch (err) {
    console.error("[testViewer] Error rendering /test:", err);
    res.status(500).send("Error generating test report: " + err.message);
  }
});

module.exports = router;
