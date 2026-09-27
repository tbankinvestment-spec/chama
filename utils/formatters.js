// utils/formatters.js
// Reusable formatting helpers shared across the app.
// - Pure functions used by Handlebars views AND by controllers / services.
// - Kept here so server.js, controllers, and templates don't duplicate logic.

/**
 * Greater-than comparison (Handlebars helper: {{#if (gt a b)}}...{{/if}})
 */
const gt = (a, b) => Number(a) > Number(b);

/**
 * Strict equality comparison (Handlebars helper)
 */
const eq = (a, b) => a === b;

/**
 * First letter, uppercase — used for avatars.
 * Ex: initial("Jane Mwangi") -> "J"
 */
const initial = (name) =>
  name && typeof name === "string" ? name.charAt(0).toUpperCase() : "?";

/**
 * Convert a full name into a dotted, lowercase username-style string.
 * Ex: emailName("Jane Mwangi") -> "jane.mwangi"
 */
const emailName = (name) =>
  name && typeof name === "string"
    ? name.toLowerCase().replace(/\s+/g, ".")
    : "user";

/**
 * Format a number as Kenyan Shillings with thousands separators.
 * Ex: formatKES(388000) -> "KSh 388,000"
 */
const formatKES = (n) => "KSh " + Number(n || 0).toLocaleString();

/**
 * Same as formatKES, but always signed (for transactions).
 * Ex: signedKES(-2000) -> "-KSh 2,000" ; signedKES(5000) -> "+KSh 5,000"
 */
const signedKES = (n) => {
  const amt = Number(n || 0);
  const formatted = "KSh " + Math.abs(amt).toLocaleString();
  return amt >= 0 ? "+" + formatted : "-" + formatted;
};

/**
 * Pretty-print JSON object in Handlebars templates.
 */
const json = (data) => JSON.stringify(data, null, 2);

module.exports = {
  gt,
  eq,
  initial,
  emailName,
  formatKES,
  signedKES,
  json,
  // All Handlebars helpers bundled together for config/hbs.js:
  helpers: { gt, eq, initial, emailName, formatKES, signedKES, json },
};
