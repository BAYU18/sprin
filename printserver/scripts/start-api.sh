#!/bin/bash
# PrintServer Pro API launcher for PM2
# Wraps tsx (ESM) so PM2's CommonJS loader doesn't choke on it

set -e
cd /root/serverbot/print/printserver/apps/server

export NODE_ENV=production
export PORT=3000
export HOST=0.0.0.0
export IPP_PORT=631
export IPP_HOST=0.0.0.0
export DATABASE_URL='postgres://printserver:prints3rv3r2024@127.0.0.1:5432/printserver'
export REDIS_URL='redis://localhost:6379'
export JWT_SECRET='printserver-super-secret-jwt-key-2024-change-in-production'
export SERVER_IP='192.168.1.141'
export SERVER_NAME='PrintServer'

# Run tsx (uses node's experimental loader to handle TS + ESM)
exec ./node_modules/.bin/tsx src/index.ts
