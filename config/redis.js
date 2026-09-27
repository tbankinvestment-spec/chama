// config/redis.js
// Redis client builder with graceful fallback.
//
// Design goals:
//   - Never crash the app or print noisy stack traces if Redis is unreachable.
//   - If `connectRedis()` fails, `redis.isReady` stays `false` and the session
//     layer in config/session.js auto-switches to a plain in-memory store.
//   - Very short connection timeout (3s) so `npm run dev` boots fast on
//     Windows machines without Redis installed.

const { createClient } = require("redis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CONNECT_TIMEOUT_MS = 3000;

let connected = false;

const redis = createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: CONNECT_TIMEOUT_MS,
    reconnectStrategy: (retries) => {
      if (retries > 2) return new Error("Redis reconnect limit reached; giving up");
      return Math.min(retries * 200, 1000);
    },
  },
});

redis.isReady = false;

redis.on("error", (err) => {
  if (connected) {
    console.error("[redis] error:", err.message);
  }
});

redis.on("ready", () => {
  connected = true;
  redis.isReady = true;
});

redis.on("end", () => {
  connected = false;
  redis.isReady = false;
});

async function connectRedis() {
  try {
    const timeout = new Promise((_, reject) => {
      const t = setTimeout(() => {
        clearTimeout(t);
        reject(new Error(`Redis connection timed out after ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS + 500);
    });
    await Promise.race([redis.connect(), timeout]);
    console.log("[redis] connected (" + REDIS_URL.replace(/\/\/[^@]+@/, "//***:***@") + ")");
    redis.isReady = true;
    connected = true;
  } catch (err) {
    redis.isReady = false;
    connected = false;
    console.warn(
      "[redis] not connected — " +
        (err && err.message ? err.message : "unknown error") +
        ". Sessions will use in-memory store (ok for local dev)."
    );
  }
}

module.exports = { redis, connectRedis };
