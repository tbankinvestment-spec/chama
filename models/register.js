// models/register.js
// MongoDB Schema for pending Chama accounts saving to 'pendingverifiedaccount' collection.

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const registerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
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
      index: true,
    },
    dob: {
      type: String,
      trim: true,
    },
    gender: {
      type: String,
      trim: true,
    },
    location: {
      county: { type: String, trim: true },
      subCounty: { type: String, trim: true },
      town: { type: String, trim: true },
      street: { type: String, trim: true },
    },
    contacts: [
      {
        name: { type: String, trim: true },
        gender: { type: String, trim: true },
        relationship: { type: String, trim: true },
        phone: { type: String, trim: true },
        email: { type: String, trim: true },
      },
    ],
    passwordHash: {
      type: String,
      required: true,
    },
    // memberIndex is sparse & null initially (should not be updated yet at registration)
    memberIndex: {
      type: Number,
      sparse: true,
      default: null,
    },
    registrationTime: {
      type: Date,
      default: Date.now,
    },
    pinkey: {
      type: String,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    kycCompleted: {
      type: Boolean,
      default: false,
    },
    passportPhoto: {
      type: String,
    },
    nationalIdPhoto: {
      type: String,
    },
    // KYC document uploads + capture metadata (liveness / face / ID scan)
    documents: {
      passportPhotoUrl: { type: String },
      idDocumentFrontUrl: { type: String },
      idDocumentBackUrl: { type: String },
      uploadedAt: { type: Date },
      // Browser-reported liveness report for the passport photo
      liveness: { type: mongoose.Schema.Types.Mixed },
      // Face properties used to personalise / crop the portrait
      faceProperties: { type: mongoose.Schema.Types.Mixed },
      // Document-scan quality report for the national ID
      idScan: { type: mongoose.Schema.Types.Mixed },
    },
    // Identity details the user confirmed after the ID scan
    identity: {
      fullName: { type: String, trim: true },
      idNumber: { type: String, trim: true },
      region: { type: String, trim: true },
      block: { type: String, trim: true },
      confirmedAt: { type: Date },
    },
    status: {
      type: String,
      default: "PENDING_VERIFICATION",
    },
  },
  {
    timestamps: true, // auto-generates & updates createdAt, updatedAt
    collection: "pendingverifiedaccount",
  }
);

registerSchema.pre("validate", function (next) {
  if (Array.isArray(this.contacts) && this.contacts.length > 0) {
    const ownerPhone = this.phone ? String(this.phone).trim() : "";
    const ownerEmail = this.email ? String(this.email).trim().toLowerCase() : "";
    const seenPhones = new Set();
    const seenEmails = new Set();

    for (let i = 0; i < this.contacts.length; i++) {
      const c = this.contacts[i];
      const cPhone = c.phone ? String(c.phone).trim() : "";
      const cEmail = c.email ? String(c.email).trim().toLowerCase() : "";

      if (cPhone && ownerPhone && cPhone === ownerPhone) {
        return next(new Error(`Contact #${i + 1} phone number cannot match the account owner's phone number.`));
      }
      if (cEmail && ownerEmail && cEmail === ownerEmail) {
        return next(new Error(`Contact #${i + 1} email address cannot match the account owner's email address.`));
      }

      if (cPhone) {
        if (seenPhones.has(cPhone)) {
          return next(new Error("Contacts cannot have duplicate phone numbers."));
        }
        seenPhones.add(cPhone);
      }

      if (cEmail) {
        if (seenEmails.has(cEmail)) {
          return next(new Error("Contacts cannot have duplicate email addresses."));
        }
        seenEmails.add(cEmail);
      }
    }
  }

  next();
});

registerSchema.methods.toSafeJSON = function () {
  const obj = this.toObject ? this.toObject() : { ...this._doc };
  delete obj.passwordHash;
  delete obj.pinkey;
  return obj;
};

registerSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Function to confirm if the collection exists and create it if not available
async function confirmAndCreateCollection() {
  if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      const collections = await mongoose.connection.db
        .listCollections({ name: "pendingverifiedaccount" })
        .toArray();
      if (collections.length === 0) {
        await mongoose.connection.db.createCollection("pendingverifiedaccount");
        console.log("[models/register] Created 'pendingverifiedaccount' collection.");
      } else {
        console.log("[models/register] Collection 'pendingverifiedaccount' is available.");
      }
    } catch (err) {
      console.warn("[models/register] Error checking/creating collection:", err.message);
    }
  }
}

mongoose.connection.on("connected", confirmAndCreateCollection);
if (mongoose.connection.readyState === 1) {
  confirmAndCreateCollection();
}

const Register =
  mongoose.models.Register ||
  mongoose.model("Register", registerSchema, "pendingverifiedaccount");

Register.confirmAndCreateCollection = confirmAndCreateCollection;

module.exports = Register;
