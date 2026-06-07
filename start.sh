#!/bin/bash
# PrintServer Pro - Startup Script
# Run: bash /root/serverbot/print/start.sh

echo "Starting PrintServer Pro..."

# Check PostgreSQL
if pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
    echo "[OK] PostgreSQL"
else
    echo "[FAIL] PostgreSQL not running"
    exit 1
fi

# Check Redis
if redis-cli ping >/dev/null 2>&1; then
    echo "[OK] Redis"
else
    echo "[FAIL] Redis not running"
    exit 1
fi

# Start API Server (background)
cd /root/serverbot/print/printserver/apps/server
DATABASE_URL="postgres://printserver:prints3rv3r2024@127.0.0.1:5432/printserver" \
REDIS_URL="redis://localhost:6379" \
JWT_SECRET="printserver-jwt-secret-change-in-production" \
NODE_ENV=production \
./node_modules/.bin/tsx src/index.ts &
API_PID=$!
echo "API Server started (PID: $API_PID)"

sleep 2

# Start Dashboard (background)
cd /root/serverbot/print/printserver/apps/dashboard
PORT=3001 ./node_modules/.bin/next start -p 3001 &
DASH_PID=$!
echo "Dashboard started (PID: $DASH_PID)"

sleep 2

echo ""
echo "═══════════════════════════════════════"
echo "  PrintServer Pro is running!"
echo "  API:   http://localhost:3000"
echo "  Dashboard: http://localhost:3001"
echo ""
echo "  Login: admin / changeme123"
echo "═══════════════════════════════════════"
echo ""
echo "PIDs: API=$API_PID, Dashboard=$DASH_PID"
echo "To stop: kill $API_PID $DASH_PID"