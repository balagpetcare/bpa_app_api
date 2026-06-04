const redis = require("../utils/redis");

module.exports = (ttl = 3600) => async (req, res, next) => {
  const key = req.originalUrl;
  try {
    const cached = await redis.get(key);
    if (cached) return res.json(JSON.parse(cached));
  } catch {
    // continue without cache
  }

  const send = res.json.bind(res);
  res.json = async (body) => {
    try {
      await redis.set(key, JSON.stringify(body), "EX", ttl);
    } catch {
      // response still sent
    }
    send(body);
  };
  next();
};

export {};
