// config/mongodb.js
// Re-exports MongoDB connection logic from config/db.js for convenience and compatibility.

const db = require("./db");

module.exports = {
  ...db,
  connectMongoDB: db.connectDB,
};
