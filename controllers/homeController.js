// controllers/homeController.js
// Handles the landing / home page rendering.

exports.showHome = (req, res) => {
  res.render("home", {
    title: "Welcome",
    layout: "main",
  });
};
