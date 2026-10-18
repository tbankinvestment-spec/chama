// config/redis.js
// Redis connection helper — provides a no-op fallback when Redis is unavailable.

function connectRedis() {
  if (process.env.REDIS_URL) {
    try {
      console.log("[redis] Connecting to", process.env.REDIS_URL);
      // TODO: add ioredis / redis client when ready
    } catch (err) {
      console.warn("[redis] Connection failed:", err.message);
    }
  } else {
    console.log("[redis] No REDIS_URL set — skipping Redis.");
  }
}

module.exports = { connectRedis };
