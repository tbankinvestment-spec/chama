// models/index.js
// Exports all application Mongoose data models.

const User = require("./User");
const Group = require("./Group");
const Transaction = require("./Transaction");
const Loan = require("./Loan");
const Contribution = require("./Contribution");

module.exports = {
  User,
  Group,
  Transaction,
  Loan,
  Contribution,
};
