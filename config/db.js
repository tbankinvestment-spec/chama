// config/db.js
// Mongoose MongoDB connection setup.
// - Reads MONGODB_URI from .env (already populated for your cluster).
// - Logs "MongoDB connected" on success.
// - On failure (e.g. no internet, wrong URI), logs a WARNING instead of
//   crashing the process — sessions + demo data still work fully in-memory,
//   so you can develop the UI without an active DB.
// - All models in ../models/ share this single mongoose connection.

const mongoose = require("mongoose");

// Connection options optimized for MongoDB Atlas stability.
// These prevent the "connect/disconnect" loop caused by Atlas closing
// idle connections and network latency spikes.
const MONGODB_OPTIONS = {
  serverSelectionTimeoutMS: 10000,   // Increased to 10s for TLS handshake
  socketTimeoutMS: 45000,            // Close sockets after 45s of inactivity
  connectTimeoutMS: 20000,           // Increased initial connection timeout
  maxPoolSize: 10,                   // Max connections in pool
  minPoolSize: 2,                    // Keep at least 2 connections warm
  maxIdleTimeMS: 30000,              // Close idle connections after 30s
  heartbeatFrequencyMS: 10000,       // Check server health every 10s
  tls: true,                         // Explicitly enable TLS/SSL
  tlsAllowInvalidHostnames: false,   // Set true only if DNS SAN mismatch
  tlsAllowInvalidCertificates: false, // Set true only for testing self-signed
};

function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn(
      "[DB] MONGODB_URI is not set. App will run in in-memory demo mode."
    );
    return;
  }

  mongoose
    .connect(uri, MONGODB_OPTIONS)
    .then(() => console.log("[DB] MongoDB connected"))
    .catch((err) =>
      console.warn(
        "[DB] MongoDB not connected, running with in-memory session data:",
        err.message
      )
    );

  // Event listeners for connection lifecycle — these log every
  // connect / disconnect / error so you can diagnose instability.
  mongoose.connection.on("connected", () => {
    console.log("[DB] MongoDB connection established");
  });

  mongoose.connection.on("error", (err) => {
    console.error("[DB] MongoDB connection error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[DB] MongoDB disconnected! Attempting to reconnect in 5s...");
    setTimeout(() => {
      if (mongoose.connection.readyState === 0) {
        mongoose
          .connect(uri, MONGODB_OPTIONS)
          .catch((err) =>
            console.warn("[DB] MongoDB reconnection failed:", err.message)
          );
      }
    }, 5000);
  });

  mongoose.connection.on("reconnected", () => {
    console.log("[DB] MongoDB reconnected successfully");
  });
}

module.exports = { connectDB, mongoose, MONGODB_OPTIONS };
