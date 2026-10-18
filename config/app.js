// config/app.js
// Express application factory — sets up middleware, view engine and static files.

const express = require("express");
const path = require("path");
const { engine } = require("express-handlebars");
const session = require("express-session");

function createApp() {
  const app = express();

  // ── Handlebars view engine ──────────────────────────────────────────
  app.engine(
    "hbs",
    engine({
      extname: ".hbs",
      defaultLayout: "main",
      layoutsDir: path.join(__dirname, "../views/layouts"),
      partialsDir: path.join(__dirname, "../views/partials"),
      helpers: {
        // Returns up to 2 uppercase initials from a full name string.
        userInitials(name) {
          if (!name || typeof name !== "string") return "?";
          const parts = name.trim().split(/\s+/).filter(Boolean);
          if (parts.length === 0) return "?";
          if (parts.length === 1) return parts[0][0].toUpperCase();
          return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        },
      },
    })
  );
  app.set("view engine", "hbs");
  app.set("views", path.join(__dirname, "../views"));

  // ── Body parsing ───────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ── Static files ───────────────────────────────────────────────────
  app.use(express.static(path.join(__dirname, "../public")));

  // ── Sessions ───────────────────────────────────────────────────────
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "chama-dev-secret",
      resave: false,
      saveUninitialized: false,
    })
  );

  return app;
}

module.exports = { createApp };
