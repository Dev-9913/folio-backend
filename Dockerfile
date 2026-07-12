# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# OpenSSL is required by Prisma's migration engine on Alpine
RUN apk add --no-cache openssl

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Generate Prisma client with the correct Alpine/musl binary
RUN npx prisma generate

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine

# OpenSSL needed at runtime for migrations + query engine
RUN apk add --no-cache openssl

# Security: non-root user
RUN addgroup -g 1001 -S folio && adduser -u 1001 -S folio -G folio

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma

COPY src          ./src
COPY package.json ./

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN chown -R folio:folio /app
USER folio

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3001/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
