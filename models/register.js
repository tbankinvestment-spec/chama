// models/register.js
// MongoDB Schema for pending Chama accounts saving to 'pendingverifiedaccount' collection.

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const registerSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
    },
    dateOfBirth: {
      type: String,
      trim: true,
      alias: "dob",
    },
    gender: {
      type: String,
      trim: true,
    },
    LocationCounty: {
      type: String,
      trim: true,
    },
    locationSubCuonty: {
      type: String,
      trim: true,
    },
    locationvilage: {
      type: String,
      trim: true,
    },
    personOneName: { type: String, trim: true },
    personOneGender: { type: String, trim: true },
    personOneRelationship: { type: String, trim: true },
    personOnePhone: { type: String, trim: true },
    personOneEmail: { type: String, trim: true },
    personTwoName: { type: String, trim: true },
    personTwoGender: { type: String, trim: true },
    personTwoRelationship: { type: String, trim: true },
    personTwoPhone: { type: String, trim: true },
    personTwoEmail: { type: String, trim: true },
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
    status: {
      type: String,
      default: "PENDING_VERIFICATION",
    },
    registrationTime: {
      type: Date,
      default: Date.now,
    },
    pinkey: {
      type: String,
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
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: "pendingverifiedaccount",
  }
);

// Virtual aliases for date of birth
registerSchema.virtual('dateofBirth')
  .get(function () { return this.dateOfBirth; })
  .set(function (val) { this.dateOfBirth = val; });

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
