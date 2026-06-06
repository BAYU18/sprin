#!/bin/bash
# PrintServer Pro Backup Tool
# Exports database and configuration files to a single backup archive.

set -e

BACKUP_DIR="/root/printserver-backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
BACKUP_NAME="printserver-backup-$TIMESTAMP"
TEMP_DIR="/tmp/$BACKUP_NAME"

echo "=== STARTING PRINTSERVER BACKUP ==="
mkdir -p "$BACKUP_DIR"
mkdir -p "$TEMP_DIR"

# 1. Backup PostgreSQL database
echo "[1/3] Exporting PostgreSQL database..."
# Allow postgres user to write into temp directory
chown postgres:postgres "$TEMP_DIR"
DB_NAME="printserver"
sudo -u postgres pg_dump -F p -b -v -d "$DB_NAME" -f "$TEMP_DIR/database.sql"
# Restore ownership of temp dir to root
chown -R root:root "$TEMP_DIR"

# 2. Backup configuration files and custom binaries
echo "[2/3] Collecting configuration and build files..."
mkdir -p "$TEMP_DIR/configs"
# Copy client-agent config if exists
if [ -f "/root/serverbot/print/printserver/apps/client-agent/src/config.json" ]; then
    cp "/root/serverbot/print/printserver/apps/client-agent/src/config.json" "$TEMP_DIR/configs/client-agent-config.json"
fi
# Copy public downloads (including printserver.apk and custom agent binaries)
if [ -d "/root/serverbot/print/printserver/apps/server/public/downloads" ]; then
    cp -r "/root/serverbot/print/printserver/apps/server/public/downloads" "$TEMP_DIR/downloads"
fi

# 3. Compress everything into one tarball
echo "[3/3] Packing backup archive..."
tar -czf "$BACKUP_DIR/$BACKUP_NAME.tar.gz" -C "$TEMP_DIR" .

# Cleanup temp files
rm -rf "$TEMP_DIR"

# 4. Auto-delete backups older than 14 days (2 weeks)
echo "Cleaning up backups older than 14 days..."
find "$BACKUP_DIR" -name "printserver-backup-*.tar.gz" -mtime +14 -type f -print -delete || echo "No old backups to clean."

echo "================================="
echo "BACKUP SUCCESSFUL!"
echo "Archive saved to: $BACKUP_DIR/$BACKUP_NAME.tar.gz"
echo "================================="
