const mongoose = require('mongoose');
const crypto = require('crypto');

const verificationCodeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  channel: {
    type: String,
    enum: ['EMAIL', 'SMS'],
    required: true,
  },
  codeHash: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }, // MongoDB TTL index to auto-delete after expiresAt
  },
  attemptsRemaining: {
    type: Number,
    default: 3,
  },
  resendAvailableAt: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true,
});

// Helper to hash OTP code
verificationCodeSchema.statics.hashCode = function(code) {
  return crypto.createHash('sha256').update(code.toString().trim()).digest('hex');
};

// Helper to verify code
verificationCodeSchema.methods.verifyCode = function(candidateCode) {
  const hash = crypto.createHash('sha256').update(candidateCode.toString().trim()).digest('hex');
  return hash === this.codeHash;
};

const VerificationCode = mongoose.model('VerificationCode', verificationCodeSchema);
module.exports = VerificationCode;
