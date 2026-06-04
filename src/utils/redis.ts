/**
 * Safe Redis cache client for policy cache, geocode cache, dashboards, etc.
 * Falls back to in-memory when Redis is disabled or unavailable.
 */
const { getSafeRedisCacheClient } = require("../infrastructure/redis/cacheClient");

const client = getSafeRedisCacheClient();

module.exports = client;
export {};
