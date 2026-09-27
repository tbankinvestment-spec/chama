// models/Loan.js
const mongoose = require("mongoose");

const loanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: { type: Number, required: true },
    balanceOutstanding: { type: Number, required: true },
    status: { type: String, enum: ["Active", "Pending", "Repaid"], default: "Active" },
    issuedDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Loan || mongoose.model("Loan", loanSchema);
