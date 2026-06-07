#!/bin/bash
# PrintServer Pro Restore Tool
# Restores database and configuration files from a backup archive.
# Usage: ./restore.sh <backup-filename.tar.gz>

set -e

LOG_FILE="/root/printserver-backups/restore.log"
BACKUP_DIR="/root/printserver-backups"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Error handler
error_exit() {
    log "ERROR: $1"
    exit 1
}

# Check argument
if [ -z "$1" ]; then
    echo "ERROR: Please provide the backup filename as argument."
    echo "Usage: ./restore.sh printserver-backup-2026-06-07.tar.gz"
    exit 1
fi

BACKUP_FILENAME="$1"
BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILENAME"

# Step 2: Validate backup file exists
log "=== STARTING PRINTSERVER RESTORE ==="
log "Validating backup file: $BACKUP_FILE"
if [ ! -f "$BACKUP_FILE" ]; then
    error_exit "Backup file not found: $BACKUP_FILE"
fi
log "Backup file validated successfully."

# Step 6: Extract backup to temp directory
TEMP_DIR="/tmp/printserver-restore-temp"
log "Extracting backup archive to temp directory..."
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

if ! tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"; then
    error_exit "Failed to extract backup archive"
fi
log "Backup archive extracted successfully."

# Step 3: Stop the printserver API service
log "Stopping printserver API service..."
if command -v pm2 &> /dev/null; then
    pm2 kill 2>/dev/null || true
    log "PM2 service stopped."
elif systemctl stop printserver-api&> /dev/null; then
    log "Systemd service stopped."
else
    log "WARNING: Could not stop service (pm2/systemctl not found)"
fi

# Step 4: Drop existing database
log "Dropping existing database..."
DB_NAME="printserver"
if mysql -u root -e "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null; then
    log "Database '$DB_NAME' dropped successfully."
else
    log "WARNING: Could not drop database (MySQL may not be running or credentials differ)"
fi

# Step 5: Recreate the database
log "Recreating database '$DB_NAME'..."
if mysql -u root -e "CREATE DATABASE $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null; then
    log "Database '$DB_NAME' created successfully."
else
    log "WARNING: Could not create database (MySQL may not be running or credentials differ)"
fi

# Step 7: Restore database SQL dump
log "Restoring database from SQL dump..."
if [ -f "$TEMP_DIR/dump.sql" ]; then
    if mysql -u root "$DB_NAME" < "$TEMP_DIR/dump.sql" 2>/dev/null; then
        log "Database dump restored successfully."
    else
        log "WARNING: Could not restore database dump (file may be empty or MySQL credentials differ)"
    fi
else
    log "WARNING: No dump.sql found in backup archive."
fi

# Step 8: Copy config files from backup to their original locations
log "Restoring configuration files..."
if [ -f "$TEMP_DIR/configs/client-agent-config.json" ]; then
    mkdir -p "/root/serverbot/print/printserver/apps/client-agent/src"
    cp "$TEMP_DIR/configs/client-agent-config.json" "/root/serverbot/print/printserver/apps/client-agent/src/config.json"
    log "Restored client-agent config.json"
fi

# Step 9: Copy any downloaded files from backup
log "Restoring public downloads..."
if [ -d "$TEMP_DIR/downloads" ]; then
    mkdir -p "/root/serverbot/print/printserver/apps/server/public"
    rm -rf "/root/serverbot/print/printserver/apps/server/public/downloads"
    cp -r "$TEMP_DIR/downloads" "/root/serverbot/print/printserver/apps/server/public/downloads"
    log "Restored public downloads folder"
fi

# Step 10: Clean up temp directory
log "Cleaning up temp directory..."
rm -rf "$TEMP_DIR"
log "Temp directory cleaned."

# Step 11: Restart the printserver API service
log "Restarting printserver API service..."
if command -v pm2 &> /dev/null; then
    cd /root/serverbot/print/printserver/apps/server
    pm2 startOrRestart ecosystem.config.js 2>/dev/null || pm2 resurrect2>/dev/null || true
    log "PM2 service restarted."
elif systemctl start printserver-api &> /dev/null; then
    log "Systemd service started."
else
    log "WARNING: Could not restart service (pm2/systemctl not found)"
fi

log "================================="
log "RESTORE COMPLETED SUCCESSFULLY!"
log "Backup file: $BACKUP_FILENAME"
log "================================="

exit 0
