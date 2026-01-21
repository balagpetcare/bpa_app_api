
const redis = require("../utils/redis");

module.exports = (ttl = 3600) => async (req, res, next) => {
  const key = req.originalUrl;
  const cached = await redis.get(key);
  if (cached) return res.json(JSON.parse(cached));

  const send = res.json.bind(res);
  res.json = async (body) => {
    await redis.set(key, JSON.stringify(body), "EX", ttl);
    send(body);
  };
  next();
};

export {};
