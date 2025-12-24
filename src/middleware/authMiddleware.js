const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) return res.status(401).json({ success: false, message: "No token" });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ success: false, message: "Invalid token" });
      req.user = user;
      next();
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Auth error" });
  }
};

module.exports = { authenticateToken };
