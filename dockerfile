# BPA API - Dockerfile (Debian-based to avoid Prisma OpenSSL 1.1 issues on Alpine)
FROM node:20-bookworm-slim

WORKDIR /app

# OS deps (openssl for Prisma engine, ca-certificates for HTTPS)
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Dependencies
COPY package*.json ./
RUN npm ci

# Prisma schema first (better layer caching)
COPY prisma ./prisma
RUN npx prisma generate

# App source
COPY . .

EXPOSE 3000

# Run migrations (safe for empty DB) then start
CMD ["sh", "-c", "npx prisma migrate deploy || true && node src/server.js"]
