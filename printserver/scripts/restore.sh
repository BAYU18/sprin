#!/bin/bash
# PrintServer Pro Restore Tool (PostgreSQL)
# Restores database and configuration files from a backup archive.
# Usage: ./restore.sh <backup-filename.tar.gz>
#
# NOTE: For full migration between servers, use migrate-export.sh + migrate-import.sh instead.

set -e
LOG_FILE="/root/printserver-backups/restore.log"
BACKUP_DIR="/root/printserver-backups"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }
error_exit() { log "ERROR: $1"; exit 1; }

if [ -z "$1" ]; then
    echo "Usage: ./restore.sh printserver-backup-2026-06-07.tar.gz"
    exit 1
fi

BACKUP_FILE="$BACKUP_DIR/$1"
log "=== STARTING PRINTSERVER RESTORE ==="

[ ! -f "$BACKUP_FILE" ] && error_exit "Backup file not found: $BACKUP_FILE"

# Extract
TEMP_DIR="/tmp/printserver-restore-temp"
rm -rf "$TEMP_DIR" && mkdir -p "$TEMP_DIR"
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"
log "Backup extracted"

# Stop services
log "Stopping services..."
pm2 stop all 2>/dev/null || true

# Restore PostgreSQL database
DB_NAME="printserver"
SQL_FILE="$TEMP_DIR/database.sql"
if [ -f "$SQL_FILE" ] && [ -s "$SQL_FILE" ]; then
    log "Restoring PostgreSQL database..."
    sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER printserver;" 2>/dev/null || true
    sudo -u postgres psql -d "$DB_NAME" < "$SQL_FILE" 2>/dev/null
    log "Database restored successfully"
else
    log "WARNING: No database.sql found or file empty"
fi

# Restore config files
if [ -f "$TEMP_DIR/configs/client-agent-config.json" ]; then
    mkdir -p "/root/serverbot/print/printserver/apps/client-agent/src"
    cp "$TEMP_DIR/configs/client-agent-config.json" "/root/serverbot/print/printserver/apps/client-agent/src/config.json"
    log "Restored client-agent config"
fi

# Restore downloads
if [ -d "$TEMP_DIR/downloads" ] && [ "$(ls -A "$TEMP_DIR/downloads" 2>/dev/null)" ]; then
    mkdir -p "/root/serverbot/print/printserver/apps/server/public"
    rm -rf "/root/serverbot/print/printserver/apps/server/public/downloads"
    cp -r "$TEMP_DIR/downloads" "/root/serverbot/print/printserver/apps/server/public/downloads"
    log "Restored downloads"
fi

# Cleanup
rm -rf "$TEMP_DIR"

# Restart
log "Restarting services..."
pm2 resurrect 2>/dev/null || pm2 startOrRestart ecosystem.config.js 2>/dev/null || true

log "================================="
log "RESTORE COMPLETED!"
log "================================="
