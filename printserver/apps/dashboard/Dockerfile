# ============================================
# PrintServer Pro - Dashboard Dockerfile
# Multi-stage build untuk Next.js
# ============================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# ============================================
# Stage 2: Builder
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build arguments untuk URL publik
ARG API_PUBLIC_URL=http://localhost:3000
ARG WS_PUBLIC_URL=ws://localhost:3000

# Set environment variables untuk build
ENV NEXT_PUBLIC_API_URL=${API_PUBLIC_URL}
ENV NEXT_PUBLIC_WS_URL=${WS_PUBLIC_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js
RUN npm run build

# ============================================
# Stage 3: Production
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies dan wget untuk healthcheck
RUN apk add --no-cache dumb-init wget

# Create non-root user
RUN addgroup -g 1001 -S nextjs && \
    adduser -S nextjs -u 1001 -G nextjs

# Create cache directory
RUN mkdir -p /app/.next/cache && chown -R nextjs:nextjs /app/.next

# Copy built artifacts
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/package.json ./

# Change to non-root user
USER nextjs

# Expose port (Next.js default)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -q --spider http://localhost:3000 || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start Next.js
CMD ["node", "server.js"]