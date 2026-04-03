# BPA API - Dockerfile (Debian-based to avoid Prisma OpenSSL issues on Alpine)
FROM node:20-bookworm-slim

WORKDIR /app

# OS deps (openssl for Prisma engine, ca-certificates for HTTPS)
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Schema + local Prisma runner must exist before `npm ci` so `postinstall` can run generate
COPY package*.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/run-local-prisma.cjs ./scripts/run-local-prisma.cjs
RUN npm ci

# Full tree (updates prisma if changed — regenerate client before build)
COPY . .
RUN node scripts/run-local-prisma.cjs generate
RUN npm run build

EXPOSE 3000

# Run migrations (safe for empty DB) then start
CMD ["sh", "-c", "node scripts/run-local-prisma.cjs migrate deploy || true && node dist/index.js"]
