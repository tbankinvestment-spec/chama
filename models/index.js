// models/index.js
// Exports all application Mongoose data models.

const Register = require("./register");
const User = Register;
const Group = require("./Group");
const Transaction = require("./Transaction");
const Loan = require("./Loan");
const Contribution = require("./Contribution");

module.exports = {
  Register,
  User,
  Group,
  Transaction,
  Loan,
  Contribution,
};
