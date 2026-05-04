# ============================================
# MooBoard Dashboard — Next.js Frontend
# Multi-stage build for minimal production image
# ============================================

# --- Stage 1: Dependencies ---
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

ENV DATABASE_URL=file:/app/data/prod.db
RUN npm ci
RUN npx prisma generate

# --- Stage 2: Build ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_BACKEND_URL=http://217.216.72.172:8000
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ENV DATABASE_URL=file:/app/data/prod.db

RUN npm run build

# --- Stage 3: Production Runner ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Create .next/cache directory for runtime caching
RUN mkdir -p ./.next/cache && chown -R nextjs:nodejs ./.next/cache

# Copy prisma scripts (init-db + seed)
COPY --from=builder /app/prisma/init-db.js ./prisma/init-db.js
COPY --from=builder /app/prisma/seed.js ./prisma/seed.js

# Copy prisma runtime client only (NO CLI needed)
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy bcryptjs for seed script
COPY --from=deps /app/node_modules/bcryptjs ./node_modules/bcryptjs

# Create data directory for SQLite (volume mount point)
RUN mkdir -p ./data && chown -R nextjs:nodejs ./data
RUN chown -R nextjs:nodejs ./prisma

# Entrypoint script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL=file:/app/data/prod.db

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
