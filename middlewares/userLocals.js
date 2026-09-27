// middlewares/userLocals.js
// Exposes the currently logged-in user to every Handlebars view via
// `res.locals.user`. This lets the layout (views/layouts/main.hbs) render
// the nav bar conditionally without every route having to pass `user` manually.
//
// Registered globally in server.js BEFORE route handlers run.

module.exports = function userLocals(req, res, next) {
  res.locals.user = (req.session && req.session.user) || null;
  next();
};
