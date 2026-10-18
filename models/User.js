// models/User.js
// Re-exports Register model pointing to 'pendingverifiedaccount' collection for full backwards compatibility.

const Register = require("./register");

module.exports = Register;
