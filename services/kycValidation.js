/**
 * KYC Validation Service
 * ---------------------------------------------------------------------------
 * Server-side counterpart to public/js/capture.js. The browser reports the
 * liveness / face / document metrics it measured; this module re-checks them
 * against the same thresholds so a tampered client cannot bypass the checks.
 *
 * Also validates the identity fields the user confirms after the ID scan.
 */

// Thresholds MUST stay in sync with CONFIG in public/js/capture.js
const THRESHOLDS = {
  MOTION_MIN_SCORE: 0.010,
  MOTION_MAX_SCORE: 0.55,
  MIN_FRAMES_ANALYZED: 10,
  MIN_BRIGHTNESS: 55,
  MAX_BRIGHTNESS: 220,
  MIN_SHARPNESS: 85,
  MIN_FACE_RATIO: 0.05,
  MAX_FACE_RATIO: 0.80,
  MIN_DOCUMENT_RATIO: 0.18,
  MIN_EDGE_DENSITY: 0.045,
  MIN_ID_ASPECT: 1.20,
  MAX_ID_ASPECT: 2.60,
};

const KENYAN_ID_RX = /^\d{7,8}$/;

const ID_KEYWORDS = [
  'REPUBLIC', 'KENYA', 'JAMHURI', 'IDENTITY', 'CARD', 'IDENTIFICATION',
  'NATIONAL', 'SERIAL', 'NUMBER', 'NO', 'DISTRICT', 'PROVINCE', 'COUNTY',
  'DATE', 'BIRTH', 'SEX', 'MALE', 'FEMALE', 'SIGNATURE', 'HUDUMA',
  'KITAMBULISHO', 'CITIZEN', 'PLACE', 'ISSUE', 'HOLDER', 'GENDER',
];

/** Safely parse a value that may arrive as JSON string (multipart form) or object. */
function asObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate the liveness + face report for the passport photo (Step 7).
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateFaceSubmission(payload) {
  const liveness = asObject(payload && payload.liveness);
  const face = asObject(payload && payload.face);
  const errors = [];
  const warnings = [];

  if (!liveness || !face) {
    return {
      valid: false,
      errors: ['Capture metadata is missing. Please retake the photo with the camera.'],
      warnings,
    };
  }

  const t = THRESHOLDS;

  // A "manual" capture happens when the automatic live check timed out or the
  // user pressed Pass. In that case the liveness signals are unavailable, so we
  // skip them and rely on the photo-quality gates below.
  const manual = liveness.manual === true;

  if (manual) {
    warnings.push('Photo was captured manually; the live-person check was skipped.');
  } else {
    if (liveness.blinkDetected !== true) {
      errors.push('Liveness failed: blink challenge was not completed.');
    }
    const frames = num(liveness.framesAnalyzed) || 0;
    if (frames < t.MIN_FRAMES_ANALYZED) {
      errors.push('Liveness failed: not enough frames analysed. Hold still and retake.');
    }
    const motion = num(liveness.motionScore);
    if (motion === null || motion < t.MOTION_MIN_SCORE) {
      errors.push('Liveness failed: no live movement detected (possible printed photo).');
    } else if (motion > t.MOTION_MAX_SCORE) {
      errors.push('Liveness failed: too much movement detected. Hold steady and retake.');
    }
    if (liveness.realPerson === false) {
      errors.push('Liveness failed: the subject was not recognised as a real person.');
    }
  }

  const brightness = num(face.brightness);
  if (brightness === null || brightness < t.MIN_BRIGHTNESS) {
    errors.push('Photo is too dark. Retake in better lighting.');
  } else if (brightness > t.MAX_BRIGHTNESS) {
    warnings.push('Photo is very bright; review is recommended.');
  }
  const sharp = num(face.sharpness);
  if (sharp === null || sharp < t.MIN_SHARPNESS) {
    errors.push('Photo is too blurry. Hold the camera steady and retake.');
  }
  const ratio = num(face.faceRatio);
  if (face.faceDetected !== true || ratio === null || ratio < t.MIN_FACE_RATIO) {
    errors.push('No face detected in the photo. Center your face and retake.');
  } else if (ratio > t.MAX_FACE_RATIO) {
    warnings.push('Face occupies most of the frame.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate the ID scan report (Step 8).
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateIdScan(payload) {
  const scan = asObject(payload && payload.scan);
  const errors = [];
  const warnings = [];

  if (!scan) {
    return {
      valid: false,
      errors: ['ID scan metadata is missing. Please rescan the document with the camera.'],
      warnings,
    };
  }

  const t = THRESHOLDS;
  const brightness = num(scan.brightness);
  if (brightness === null || brightness < t.MIN_BRIGHTNESS) {
    errors.push('ID image is too dark. Rescan with even lighting.');
  } else if (brightness > t.MAX_BRIGHTNESS) {
    errors.push('ID image has too much glare. Tilt the card away from light and rescan.');
  }
  const sharp = num(scan.sharpness);
  if (sharp === null || sharp < t.MIN_SHARPNESS) {
    errors.push('ID image is blurry. Hold the camera steady and rescan.');
  }
  const docRatio = num(scan.documentRatio);
  if (docRatio === null || docRatio < t.MIN_DOCUMENT_RATIO) {
    errors.push('The ID did not fill enough of the frame. Move it closer and rescan.');
  }
  const edges = num(scan.edgeDensity);
  if (edges === null || edges < t.MIN_EDGE_DENSITY) {
    errors.push('Could not read the ID text. Make sure the whole card is visible and rescan.');
  }
  const aspect = num(scan.aspect);
  if (aspect !== null && (aspect < t.MIN_ID_ASPECT || aspect > t.MAX_ID_ASPECT)) {
    warnings.push('The ID does not look flat/landscape. Check the photo orientation.');
  }
  if (scan.documentDetected === false) {
    errors.push('No document detected. Align the ID inside the frame and rescan.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate the identity fields the user confirmed on the confirmation card.
 * @returns {{ valid: boolean, errors: string[], identity: object }}
 */
function validateIdentity(payload) {
  const identity = asObject(payload && payload.identity) || {};
  const errors = [];

  const fullName = String(identity.fullName || '').replace(/\s+/g, ' ').trim();
  const idNumber = String(identity.idNumber || '').replace(/\s/g, '');
  const region = String(identity.region || '').trim();
  const block = String(identity.block || '').trim();

  const nameParts = fullName.split(' ').filter((p) => p.length > 1);
  if (nameParts.length < 2) {
    errors.push('Full name must contain at least two names.');
  }
  if (!KENYAN_ID_RX.test(idNumber)) {
    errors.push('ID number must be 7 or 8 digits.');
  }
  if (region.length < 2) {
    errors.push('Region / county is required.');
  }
  if (block.length < 2) {
    errors.push('Block / estate is required.');
  }

  return {
    valid: errors.length === 0,
    errors,
    identity: { fullName, idNumber, region, block },
  };
}

/**
 * Server-side mirror of the browser ID parser. Used to sanity-check (not
 * replace) the values the user confirms.
 */
function parseKenyanIdText(rawText) {
  const raw = String(rawText || '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let idNumber = '';
  const idMatch = raw.replace(/[^0-9\n]/g, ' ').match(/\b\d{7,8}\b/);
  if (idMatch) idNumber = idMatch[0];
  if (!idNumber) {
    const loose = raw.match(/(?:ID|NO|NUMBER|SERIAL)[^0-9]{0,6}(\d{6,9})/i);
    if (loose) idNumber = loose[1];
  }

  let fullName = '';
  lines.forEach((line) => {
    const words = line.replace(/[^A-Za-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
    if (words.length < 2) return;
    const kept = words.filter((w) => ID_KEYWORDS.indexOf(w.toUpperCase()) === -1);
    if (kept.length >= 2) {
      const candidate = kept.join(' ');
      if (candidate.length > fullName.length) fullName = candidate;
    }
  });

  let region = '';
  lines.forEach((line) => {
    const m = line.match(/(?:DISTRICT|PROVINCE|COUNTY)\s*[:\-]?\s*([A-Za-z\s]{3,})/i);
    if (m && !region) region = m[1].trim();
  });

  return { fullName: fullName.trim(), idNumber, region, block: '', raw };
}

module.exports = {
  THRESHOLDS,
  KENYAN_ID_RX,
  validateFaceSubmission,
  validateIdScan,
  validateIdentity,
  parseKenyanIdText,
  asObject,
};
