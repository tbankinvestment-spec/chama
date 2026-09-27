// config/app.js
// Builds the base Express app with cross-cutting middleware (body parsers,
// static files, sessions, template engine, locals, etc.).
// Keeps server.js thin — server.js just mounts routes and calls listen().

const path = require("path");
const express = require("express");
const sessionConfig = require("./session");
const { createHbsEngine } = require("./hbs");
const userLocals = require("../middlewares/userLocals");

function createApp() {
  const app = express();

  // Body parsers: JSON bodies (API) + URL-encoded bodies (HTML forms)
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Security Headers: Protect against Clickjacking, MIME sniffing, and Referrer leakage
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // Prevent sensitive data and OTP forms from being cached by browsers/proxies
    if (
      req.path.startsWith("/login") ||
      req.path.startsWith("/register") ||
      req.path.startsWith("/verify") ||
      req.path.startsWith("/forgot-pin")
    ) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    next();
  });

  // Session support (before route handlers, after static files).
  app.use(sessionConfig);

  // Lightweight flash helper (keeps us from adding connect-flash as a dep).
  // Usage: req.flash(type, value) to set; req.flash(type) to read & clear.
  app.use((req, res, next) => {
    if (!req.session._flash) req.session._flash = {};
    req.flash = function flash(type, value) {
      if (arguments.length === 2) {
        req.session._flash = req.session._flash || {};
        req.session._flash[type] = value;
        return null;
      }
      const store = req.session._flash || {};
      const val = store[type];
      delete store[type];
      return val || (type === "errors" || type === "messages" ? undefined : null);
    };
    next();
  });

  // Expose flash values to templates once per request.
  app.use((req, res, next) => {
    res.locals.errors = req.flash("errors") || {};
    res.locals.messages = req.flash("messages") || {};
    next();
  });

  // Handlebars view engine.
  app.engine("hbs", createHbsEngine());
  app.set("view engine", "hbs");
  app.set("views", [
    path.join(__dirname, "..", "views"),
    path.join(__dirname, "..", "tests"),
  ]);

  // Make session.user available to every template.
  app.use(userLocals);

  return app;
}

module.exports = { createApp };
