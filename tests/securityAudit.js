// tests/securityAudit.js
// Automated Data Leakage & Security Vulnerability Scanner for Chama.
// Scans codebase, environment, session configs, and runtime endpoints
// to verify compliance and detect accidental data exposures.

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

/**
 * Recursively scans project files for suspicious secrets or patterns.
 */
function scanSourceForSecrets(dir, results = []) {
  const IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".gemini",
  ]);

  const IGNORED_FILES = new Set([
    "package-lock.json",
    ".env",
    ".env.example",
    "README.md",
    "README.txt",
  ]);

  // Regex patterns indicating hardcoded credentials or secret leaks
  const SECRET_PATTERNS = [
    { name: "Hardcoded MongoDB URI with credentials", regex: /mongodb(\+srv)?:\/\/[a-zA-Z0-9_]+:[^@\s]+@[a-zA-Z0-9.-]+/i },
    { name: "Hardcoded API Key / Token", regex: /['"`](sk_live_[0-9a-zA-Z]{24,}|AIzaSy[0-9A-Za-z-_]{33})['"`]/ },
    { name: "Hardcoded Private Key", regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
    { name: "Exposed JWT Secret", regex: /(jwt_secret|jwtSecret)\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i },
  ];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          scanSourceForSecrets(fullPath, results);
        }
      } else if (entry.isFile()) {
        if (!IGNORED_FILES.has(entry.name) && /\.(js|hbs|json|html|ts)$/i.test(entry.name)) {
          try {
            const content = fs.readFileSync(fullPath, "utf8");
            for (const pattern of SECRET_PATTERNS) {
              if (pattern.regex.test(content)) {
                results.push({
                  file: path.relative(ROOT_DIR, fullPath).replace(/\\/g, "/"),
                  risk: pattern.name,
                });
              }
            }
          } catch {
            // Ignore unreadable files
          }
        }
      }
    }
  } catch (err) {
    console.warn("[securityAudit] Scan directory error:", err.message);
  }

  return results;
}

/**
 * Runs the complete data vulnerability & leakage audit suite.
 */
function runSecurityAudit() {
  const checks = [];

  // --------------------------------------------------------------------------
  // Check 1: Static Code Secret & Credential Leakage Scan
  // --------------------------------------------------------------------------
  const leaksFound = scanSourceForSecrets(ROOT_DIR);
  if (leaksFound.length === 0) {
    checks.push({
      id: "SEC-01",
      category: "Secret Leakage",
      title: "Hardcoded Credentials in Source Code",
      status: "PASS",
      message: "No hardcoded database URIs, API keys, or private keys detected in codebase.",
      severity: "High",
    });
  } else {
    checks.push({
      id: "SEC-01",
      category: "Secret Leakage",
      title: "Hardcoded Credentials in Source Code",
      status: "FAIL",
      message: `Detected ${leaksFound.length} potential credential leak(s): ` +
        leaksFound.map((l) => `${l.file} (${l.risk})`).join(", "),
      severity: "High",
      remediation: "Move hardcoded secrets into .env and load them via process.env.",
    });
  }

  // --------------------------------------------------------------------------
  // Check 2: Git Exclusion Protection (.gitignore for .env and secrets)
  // --------------------------------------------------------------------------
  const gitignorePath = path.join(ROOT_DIR, ".gitignore");
  let gitignoreContent = "";
  try {
    gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
  } catch {}

  const ignoresEnv = /^\.env/m.test(gitignoreContent);
  const ignoresModules = /^node_modules/m.test(gitignoreContent);

  if (ignoresEnv && ignoresModules) {
    checks.push({
      id: "SEC-02",
      category: "Configuration",
      title: ".gitignore Protection for Secrets",
      status: "PASS",
      message: ".env and node_modules are properly tracked in .gitignore to prevent accidental git repository leaks.",
      severity: "High",
    });
  } else {
    checks.push({
      id: "SEC-02",
      category: "Configuration",
      title: ".gitignore Protection for Secrets",
      status: "FAIL",
      message: ".gitignore is missing protection rules for .env or node_modules.",
      severity: "High",
      remediation: "Ensure .env and node_modules are listed in .gitignore.",
    });
  }

  // --------------------------------------------------------------------------
  // Check 3: Session Secret Strength & Entropy
  // --------------------------------------------------------------------------
  const sessionSecret = process.env.SESSION_SECRET || "";
  const isDefaultWeak =
    !sessionSecret ||
    sessionSecret.toLowerCase() === "secret" ||
    sessionSecret.toLowerCase() === "keyboard cat" ||
    sessionSecret.length < 16;

  if (!isDefaultWeak) {
    checks.push({
      id: "SEC-03",
      category: "Session Security",
      title: "Session Secret Cryptographic Strength",
      status: "PASS",
      message: `SESSION_SECRET is configured with sufficient entropy (${sessionSecret.length} characters).`,
      severity: "Medium",
    });
  } else {
    checks.push({
      id: "SEC-03",
      category: "Session Security",
      title: "Session Secret Cryptographic Strength",
      status: "WARN",
      message: "SESSION_SECRET is weak, empty, or default. Session cookies could be forged.",
      severity: "Medium",
      remediation: "Set a strong random 32+ character string for SESSION_SECRET in .env.",
    });
  }

  // --------------------------------------------------------------------------
  // Check 4: Cookie Theft & Cross-Site Scripting (XSS) Protection
  // --------------------------------------------------------------------------
  let sessionConfigContent = "";
  try {
    sessionConfigContent = fs.readFileSync(path.join(ROOT_DIR, "config", "session.js"), "utf8");
  } catch {}

  const hasHttpOnly = /httpOnly:\s*true/.test(sessionConfigContent);
  if (hasHttpOnly) {
    checks.push({
      id: "SEC-04",
      category: "Data Leakage",
      title: "Session Cookie Theft Protection (httpOnly)",
      status: "PASS",
      message: "Session cookie has httpOnly: true enabled, preventing client-side JavaScript access and XSS theft.",
      severity: "High",
    });
  } else {
    checks.push({
      id: "SEC-04",
      category: "Data Leakage",
      title: "Session Cookie Theft Protection (httpOnly)",
      status: "FAIL",
      message: "httpOnly flag is missing or false on session cookies.",
      severity: "High",
      remediation: "Set cookie: { httpOnly: true } in config/session.js.",
    });
  }

  // --------------------------------------------------------------------------
  // Check 5: Anti-Brute-Force & Rate Limiter Protection on Auth Endpoints
  // --------------------------------------------------------------------------
  let authRoutesContent = "";
  let verifyRoutesContent = "";
  try {
    authRoutesContent = fs.readFileSync(path.join(ROOT_DIR, "routes", "logauth.js"), "utf8");
    verifyRoutesContent = fs.readFileSync(path.join(ROOT_DIR, "routes", "verify.js"), "utf8");
  } catch {}

  const hasLoginLimit = /router\.post\(\s*["']\/login["'],\s*loginBlock/.test(authRoutesContent);
  const hasRegisterLimit = /router\.post\(\s*["']\/register["'],\s*registerBlock/.test(authRoutesContent);
  const hasOtpLimit = /otpSendBlock/.test(verifyRoutesContent) && /otpCheckBlock/.test(verifyRoutesContent);

  if (hasLoginLimit && hasRegisterLimit && hasOtpLimit) {
    checks.push({
      id: "SEC-05",
      category: "Traffic & Anti-Flooding",
      title: "Authentication Brute-Force & Flooding Defense",
      status: "PASS",
      message: "All sensitive authentication and OTP endpoints are guarded by traffic rate-limit blocks.",
      severity: "High",
    });
  } else {
    checks.push({
      id: "SEC-05",
      category: "Traffic & Anti-Flooding",
      title: "Authentication Brute-Force & Flooding Defense",
      status: "WARN",
      message: "One or more authentication routes are missing traffic rate-limiting middlewares.",
      severity: "High",
      remediation: "Mount loginBlock, registerBlock, and OTP blocks in routes/logauth.js and routes/verify.js.",
    });
  }

  // --------------------------------------------------------------------------
  // Check 6: Sensitive Field Redaction & Output Sanitization
  // --------------------------------------------------------------------------
  let testViewerContent = "";
  try {
    testViewerContent = fs.readFileSync(path.join(ROOT_DIR, "tests", "testViewer.js"), "utf8");
  } catch {}

  const masksPassword = /copy\.passwordHash\s*=\s*["']?\[.*\]["']?/.test(testViewerContent);
  const masksPin = /copy\.pin\s*=\s*["']?\[.*\]["']?/.test(testViewerContent);

  if (masksPassword && masksPin) {
    checks.push({
      id: "SEC-06",
      category: "Data Leakage",
      title: "Sensitive Field Redaction in Test Feeds",
      status: "PASS",
      message: "User password hashes and plaintext OTP PINs are scrubbed before rendering in inspector outputs.",
      severity: "High",
    });
  } else {
    checks.push({
      id: "SEC-06",
      category: "Data Leakage",
      title: "Sensitive Field Redaction in Test Feeds",
      status: "WARN",
      message: "Password hashes or PINs may be exposed unmasked in debug/inspector endpoints.",
      severity: "High",
      remediation: "Sanitize sample documents in tests/testViewer.js before serialization.",
    });
  }

  // --------------------------------------------------------------------------
  // Summary Aggregations
  // --------------------------------------------------------------------------
  const passed = checks.filter((c) => c.status === "PASS").length;
  const warnings = checks.filter((c) => c.status === "WARN").length;
  const failed = checks.filter((c) => c.status === "FAIL").length;

  return {
    timestamp: new Date().toISOString(),
    summary: {
      total: checks.length,
      passed,
      warnings,
      failed,
      compliant: failed === 0,
      securityScore: Math.round((passed / checks.length) * 100),
    },
    checks,
  };
}

module.exports = {
  runSecurityAudit,
};
