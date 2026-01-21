
const Redis = require("ioredis");
module.exports = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: 6379,
});

export {};
