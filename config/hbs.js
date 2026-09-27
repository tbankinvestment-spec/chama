// config/hbs.js
// Handlebars view-engine setup.
// - Sets extname `.hbs`, points layouts to views/layouts/, partials to
//   views/partials/, and uses 'main' as the default wrapper.
// - Registers shared helpers from ../utils/formatters.js so every template
//   automatically has access to `gt`, `eq`, `initial`, `formatKES`, etc.
//
// Used by server.js via:
//   app.engine("hbs", createHbsEngine());
//   app.set("view engine", "hbs");

const path = require("path");
const handlebars = require("express-handlebars");
const { helpers } = require("../utils/formatters");

function createHbsEngine() {
  return handlebars.engine({
    extname: ".hbs",
    layoutsDir: path.join(__dirname, "..", "views", "layouts"),
    partialsDir: path.join(__dirname, "..", "views", "partials"),
    defaultLayout: "main",
    helpers,
  });
}

module.exports = { createHbsEngine };
