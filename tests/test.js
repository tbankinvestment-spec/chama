/**
 * tests/test.js
 * Comprehensive regression & smoke test suite for the Chama application.
 * Run automatically or on-demand after updates:
 *   node tests/test.js
 *   or
 *   npm test
 */

require("dotenv").config();
const http = require("http");

let passed = 0;
let failed = 0;

function report(name, isPass, details = "") {
  if (isPass) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✗\x1b[0m ${name}${details ? ` -> ${details}` : ""}`);
  }
}

async function runTestSuite() {
  console.log("\n========================================");
  console.log("   CHAMA SYSTEM & REGRESSION TEST SUITE  ");
  console.log("========================================\n");

  // ----------------------------------------------------
  // Phase 1: Module Integrity & Syntax Verification
  // ----------------------------------------------------
  console.log("1. Verifying Core Modules & Schemas:");

  const modulesToCheck = [
    { name: "App Factory (config/app)", path: "../config/app" },
    { name: "Database Config (config/db)", path: "../config/db" },
    { name: "MongoDB Wrapper (config/mongodb)", path: "../config/mongodb" },
    { name: "Redis Config (config/redis)", path: "../config/redis" },
    { name: "Session Config (config/session)", path: "../config/session" },
    { name: "User Model (models/User)", path: "../models/User" },
    { name: "Group Model (models/Group)", path: "../models/Group" },
    { name: "Transaction Model (models/Transaction)", path: "../models/Transaction" },
    { name: "Loan Model (models/Loan)", path: "../models/Loan" },
    { name: "Contribution Model (models/Contribution)", path: "../models/Contribution" },
    { name: "Auth Controller (controllers/logauthController)", path: "../controllers/logauthController" },
    { name: "Verify Controller (controllers/verifyController)", path: "../controllers/verifyController" },
    { name: "Home Controller (controllers/homeController)", path: "../controllers/homeController" },
    { name: "Dashboard Controller (controllers/dashboardController)", path: "../controllers/dashboardController" },
    { name: "Chama Data Service (services/chamaData)", path: "../services/chamaData" },
    { name: "Email Service (services/email)", path: "../services/email" },
    { name: "SMS Service (services/sms)", path: "../services/sms" },
    { name: "Traffic Limiter (middlewares/trafficLimiter)", path: "../middlewares/trafficLimiter" },
    { name: "Security Audit Module (tests/securityAudit)", path: "./securityAudit" },
  ];

  for (const mod of modulesToCheck) {
    try {
      require(mod.path);
      report(`Loaded ${mod.name}`, true);
    } catch (err) {
      report(`Loaded ${mod.name}`, false, err.message);
    }
  }

  // ----------------------------------------------------
  // Phase 2: Live Server & HTTP Route Checks
  // ----------------------------------------------------
  console.log("\n2. Verifying Server Startup & HTTP Routes:");

  let server;
  try {
    const { createApp } = require("../config/app");
    const { connectDB } = require("../config/db");
    const homeRoutes = require("../routes/home");
    const authRoutes = require("../routes/logauth");
    const dashboardRoutes = require("../routes/dashboard");
    const verifyRoutes = require("../routes/verify");
    const testViewerRoutes = require("./testViewer");

    const app = createApp();
    app.use(homeRoutes);
    app.use(authRoutes);
    app.use(dashboardRoutes);
    app.use(verifyRoutes);
    app.use(testViewerRoutes);

    // Suppress unhandled DB logs for quick test run
    connectDB();

    server = http.createServer(app);

    await new Promise((resolve, reject) => {
      // Port 0 lets the OS assign any free ephemeral port
      server.listen(0, () => resolve());
      server.on("error", reject);
    });

    const port = server.address().port;
    report(`Server started successfully on dynamic port ${port}`, true);

    const routesToCheck = [
      { path: "/", expectedStatus: 200, label: "Home Page (GET /)" },
      { path: "/login", expectedStatus: 200, label: "Login Page (GET /login)" },
      { path: "/register", expectedStatus: 200, label: "Register Page (GET /register)" },
      {
        path: "/dashboard",
        expectedStatus: 302,
        label: "Protected Dashboard unauthenticated redirect (GET /dashboard -> 302 to /login)",
      },
      {
        path: "/verify",
        expectedStatus: 302,
        label: "Verification uninitialized session redirect (GET /verify -> 302 to /register)",
      },
      {
        path: "/test",
        expectedStatus: 200,
        label: "Live Data Structure Inspector (GET /test)",
      },
    ];

    for (const r of routesToCheck) {
      await new Promise((resolve) => {
        const req = http.get(
          {
            host: "localhost",
            port: port,
            path: r.path,
          },
          (res) => {
            const isMatch = res.statusCode === r.expectedStatus;
            report(
              r.label,
              isMatch,
              `Status: ${res.statusCode} (Expected: ${r.expectedStatus})`
            );
            res.resume(); // consume stream to free memory
            resolve();
          }
        );

        req.on("error", (err) => {
          report(r.label, false, err.message);
          resolve();
        });
      });
    }
  } catch (err) {
    report("Server startup and route testing", false, err.message);
  } finally {
    if (server && server.listening) {
      server.close();
    }
  }

  // ----------------------------------------------------
  // Phase 3: Data Leakage & Security Vulnerability Audit
  // ----------------------------------------------------
  console.log("\n3. Verifying Data Leakage & Security Vulnerabilities:");

  const { runSecurityAudit } = require("./securityAudit");
  const audit = runSecurityAudit();

  for (const check of audit.checks) {
    if (check.status === "PASS") {
      report(`[${check.category}] ${check.title}`, true);
    } else if (check.status === "WARN") {
      console.log(`  \x1b[33m⚠\x1b[0m [${check.category}] ${check.title} -> ${check.message}`);
    } else {
      report(`[${check.category}] ${check.title}`, false, check.message);
    }
  }

  // ----------------------------------------------------
  // Summary & Exit Status
  // ----------------------------------------------------
  console.log("\n----------------------------------------");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("----------------------------------------\n");

  if (failed > 0) {
    console.error("Test run failed! Check above errors for details.\n");
    process.exit(1);
  } else {
    console.log("All systems operational. No update errors detected!\n");
    process.exit(0);
  }
}

runTestSuite();
