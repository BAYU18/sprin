# ============================================
# PrintServer Pro - Server Dockerfile
# Multi-stage build untuk production
# ============================================

# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:20-alpine AS production

WORKDIR /app

# Install production runtime dependencies only
RUN apk add --no-cache dumb-init wget

# Create non-root user
RUN addgroup -g 1001 -S printserver && \
    adduser -S printserver -u 1001 -G printserver

# Create logs directory
RUN mkdir -p /app/logs && chown -R printserver:printserver /app/logs

# Copy built artifacts from builder
COPY --from=builder --chown=printserver:printserver /app/dist ./dist
COPY --from=builder --chown=printserver:printserver /app/node_modules ./node_modules
COPY --from=builder --chown=printserver:printserver /app/package.json ./package.json
COPY --from=builder --chown=printserver:printserver /app/package-lock.json ./package-lock.json

# Change to non-root user
USER printserver

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -q --spider http://localhost:3000/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["node", "dist/index.js"]