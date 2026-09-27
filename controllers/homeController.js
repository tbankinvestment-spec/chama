// controllers/homeController.js
// Thin controller for the marketing home page.
// Renders views/home.hbs wrapped in views/layouts/main.hbs with a title.

exports.showHome = (req, res) => {
  res.render("home", { title: "Home" });
};
