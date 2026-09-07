// Guards the admin portal's JSON API. Session-based — set on successful login in adminController.
function requireAdminApi(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.status(401).json({ error: "Niet ingelogd." });
}

module.exports = { requireAdminApi };
