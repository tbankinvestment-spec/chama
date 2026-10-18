/**
 * Kenyan Phone Number Normalizer & Validator
 * Standardizes to E.164 format (+254XXXXXXXXX)
 */
function normalizeKenyanPhone(phone) {
  if (!phone || typeof phone !== 'string') return null;

  // Strip all non-digit and non-plus characters (spaces, dashes, parens)
  let cleaned = phone.replace(/[\s\-()]/g, '').trim();

  // If starts with +254
  if (cleaned.startsWith('+254')) {
    cleaned = cleaned.substring(1); // remove +
  } else if (cleaned.startsWith('0')) {
    // 07... or 01... -> 2547... or 2541...
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
    if (cleaned.length === 9) {
      cleaned = '254' + cleaned;
    }
  }

  // Validate Kenyan mobile format: 254 followed by 7XX or 1XX (9 digits total after 254)
  const regex = /^254(7\d{8}|1\d{8})$/;
  if (!regex.test(cleaned)) {
    return null;
  }

  return `+${cleaned}`;
}

function isValidKenyanPhone(phone) {
  return normalizeKenyanPhone(phone) !== null;
}

module.exports = {
  normalizeKenyanPhone,
  isValidKenyanPhone,
};
