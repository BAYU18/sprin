#!/bin/bash
# ============================================
# PrintServer Pro — Full Migration Export
# Jalankan di SERVER LAMA
# Hasil: /tmp/printserver-migration.tar.gz
# ============================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()  { echo -e "${GREEN}  ✓${NC} $1"; }
err() { echo -e "${RED}  ✗${NC} $1"; }

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  PrintServer Pro — Migration Export${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

PROJECT_DIR="/root/serverbot/print/printserver"
WORK_DIR="/tmp/printserver-export-$$"
ARCHIVE="/tmp/printserver-migration.tar.gz"

mkdir -p "$WORK_DIR"/{db,configs,downloads,scripts,agent}

# ── 1. PostgreSQL Dump ──────────────────────────────────────────────────────
log "[1/5] Exporting PostgreSQL database..."
if sudo -u postgres pg_dump -F p -b -d printserver -f "$WORK_DIR/db/printserver.sql" 2>/dev/null; then
    ok "Database exported ($(du -h "$WORK_DIR/db/printserver.sql" | cut -f1))"
else
    err "pg_dump failed — cek apakah PostgreSQL jalan"
    exit 1
fi

# ── 2. Konfigurasi (.env, secrets) ──────────────────────────────────────────
log "[2/5] Backing up configuration..."
# Server .env
cp "$PROJECT_DIR/apps/server/.env" "$WORK_DIR/configs/server.env" 2>/dev/null && ok "apps/server/.env" || true

# Client-agent config
cp "$PROJECT_DIR/apps/client-agent/src/config.json" "$WORK_DIR/configs/client-agent-config.json" 2>/dev/null && ok "client-agent config" || true

# Dashboard .env.local (kalau ada)
cp "$PROJECT_DIR/apps/dashboard/.env.local" "$WORK_DIR/configs/dashboard.env.local" 2>/dev/null && ok "dashboard .env.local" || true

# PM2 dump
pm2 save --force 2>/dev/null && cp /root/.pm2/dump.pm2 "$WORK_DIR/configs/dump.pm2" 2>/dev/null && ok "PM2 process list" || true

# ── 3. Public downloads (agent .bat, APK, custom binaries) ──────────────────
log "[3/5] Backing up public downloads..."
if [ -d "$PROJECT_DIR/apps/server/public/downloads" ]; then
    cp -r "$PROJECT_DIR/apps/server/public/downloads/"* "$WORK_DIR/downloads/" 2>/dev/null && ok "downloads/" || true
fi

# ── 4. Scripts & Docker configs ─────────────────────────────────────────────
log "[4/5] Copying scripts & docker configs..."
cp "$PROJECT_DIR/scripts/"*.sh "$WORK_DIR/scripts/" 2>/dev/null && ok "scripts/" || true
cp "$PROJECT_DIR/docker/"* "$WORK_DIR/scripts/" 2>/dev/null && ok "docker/" || true

# ── 5. Pack ─────────────────────────────────────────────────────────────────
log "[5/5] Creating migration archive..."
tar -czf "$ARCHIVE" -C "$WORK_DIR" .

# Cleanup
rm -rf "$WORK_DIR"

SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  EXPORT BERHASIL!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  Archive: ${YELLOW}$ARCHIVE${NC} ($SIZE)"
echo ""
echo -e "  ${BLUE}Langkah selanjutnya:${NC}"
echo -e "  1. Copy archive ke server baru:"
echo -e "     ${YELLOW}scp $ARCHIVE root@<IP_SERVER_BARU>:/tmp/${NC}"
echo ""
echo -e "  2. Di server baru jalankan:"
echo -e "     ${YELLOW}bash migrate-import.sh${NC}"
echo ""
