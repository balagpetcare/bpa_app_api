require("dotenv").config();

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  apiPrefix: process.env.API_PREFIX || "/api/v1",
};

module.exports = { env };
