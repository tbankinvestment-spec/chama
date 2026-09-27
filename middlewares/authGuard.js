// middlewares/authGuard.js
// Route-level middleware that blocks unauthenticated visitors from pages
// that need a login session (e.g. /dashboard).
// If a session user is missing, the visitor is redirected to /login.
//
// Usage (in a route):
//   router.get("/dashboard", authGuard, (req, res) => { ... });

module.exports = function authGuard(req, res, next) {
  if (req.session && req.session.user) {
    console.log("[middlewares/authGuard] Authenticated user:", req.session.user.phone || req.session.user.email || "unknown");
    return next();
  }
  console.warn("[middlewares/authGuard] Unauthenticated access attempt to protected route:", req.path);
  return res.redirect("/login");
};
