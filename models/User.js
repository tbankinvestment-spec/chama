// models/User.js
// MongoDB User schema for Chama members and authentication data.

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: 1, // Ascending index (smallest to largest)
    },
    memberIndex: {
      type: Number,
      unique: true,
      index: 1, // 7-digit integer starting from 1000000 ordered smallest to largest
    },
    registrationTime: {
      type: Date,
      default: Date.now,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    pinkey: {
      type: String, // SMS verification number from sms.js
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: "users",
  }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
