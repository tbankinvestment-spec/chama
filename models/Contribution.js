// models/Contribution.js
const mongoose = require("mongoose");

const contributionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Contribution || mongoose.model("Contribution", contributionSchema);
