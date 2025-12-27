const jwt = require("jsonwebtoken");
const appConfig = require("../config/appConfig");

module.exports = function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized: token missing" });
    }

    const payload = jwt.verify(token, appConfig.jwt.secret);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "Unauthorized: invalid token" });
  }
};
