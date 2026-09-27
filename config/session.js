// config/session.js
// express-session configuration with graceful fallback:
//   - If Redis is reachable (redis.isReady === true), sessions are stored in
//     Redis via connect-redis so they survive nodemon restarts and scale.
//   - If Redis is NOT reachable (typical on Windows local dev without Redis
//     installed), falls back to express-session's built-in MemoryStore. A
//     single warning is printed; no stack traces, no crashes.
//
// Other notes:
//   - Uses SESSION_SECRET from .env; falls back to a dev-only default.
//   - `httpOnly` cookies prevent XSS from reading the session id.
//   - `saveUninitialized: false` + `resave: false` are the official
//     production recommendations for express-session.

const session = require("express-session");
const { RedisStore } = require("connect-redis");
const { redis } = require("./redis");

function buildStore() {
  if (redis.isReady) {
    return new RedisStore({
      client: redis,
      prefix: "chama:sess:",
    });
  }
  return undefined;
}

let store = buildStore();
let warned = false;

function getStore() {
  if (redis.isReady && !(store && store.prefix)) {
    store = new RedisStore({ client: redis, prefix: "chama:sess:" });
  }
  if (!store && !warned) {
    warned = true;
    console.warn(
      "[session] Redis is unavailable; falling back to MemoryStore. " +
        "Sessions will not survive a server restart (OK for local dev)."
    );
  }
  return store;
}

const sessionConfig = session({
  store: getStore(),
  secret: process.env.SESSION_SECRET || "chama-secret-key-2026-dev-only",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000,
  },
});

module.exports = sessionConfig;
module.exports.buildStore = buildStore;
