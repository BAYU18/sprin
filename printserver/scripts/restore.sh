#!/bin/bash
# PrintServer Pro Restore Tool
# Restores database and configuration files from a backup archive.

set -e

if [ -z "$1" ]; then
    echo "ERROR: Please provide path to the backup archive."
    echo "Usage: ./restore.sh /path/to/backup-file.tar.gz"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
fi

TEMP_DIR="/tmp/printserver-restore-temp"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

echo "=== STARTING PRINTSERVER RESTORE ==="
echo "Extracting archive: $BACKUP_FILE..."
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# 1. Restore database
DB_NAME="printserver"
if [ -f "$TEMP_DIR/database.sql" ]; then
    echo "[1/3] Restoring PostgreSQL database..."
    
    # Recreate database to ensure clean state
    echo "  Recreating database $DB_NAME..."
    sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" || true
    sudo -u postgres dropdb --if-exists "$DB_NAME"
    sudo -u postgres createdb -O printserver "$DB_NAME"
    
    # Import SQL
    echo "  Importing schema and data..."
    sudo -u postgres psql -d "$DB_NAME" -f "$TEMP_DIR/database.sql"
else
    echo "[1/3] WARNING: No database.sql found in backup. Skipping database restore."
fi

# 2. Restore configs
echo "[2/3] Restoring configurations..."
if [ -f "$TEMP_DIR/configs/client-agent-config.json" ]; then
    mkdir -p "/root/serverbot/print/printserver/apps/client-agent/src"
    cp "$TEMP_DIR/configs/client-agent-config.json" "/root/serverbot/print/printserver/apps/client-agent/src/config.json"
    echo "  Restored client-agent config.json"
fi

# 3. Restore public downloads
echo "[3/3] Restoring public downloads (binaries, APKs)..."
if [ -d "$TEMP_DIR/downloads" ]; then
    mkdir -p "/root/serverbot/print/printserver/apps/server/public"
    rm -rf "/root/serverbot/print/printserver/apps/server/public/downloads"
    cp -r "$TEMP_DIR/downloads" "/root/serverbot/print/printserver/apps/server/public/downloads"
    echo "  Restored public downloads folder"
fi

# Run knex migrations to make sure db structure matches current code
echo "Running migrations if any new schema updates..."
cd /root/serverbot/print/printserver/apps/server
npm run db:migrate || echo "Knex migrations skipped (might be running raw schemas)"

# Clean up
rm -rf "$TEMP_DIR"

echo "================================="
echo "RESTORE COMPLETED SUCCESSFULLY!"
echo "Please restart PM2 services to apply changes:"
echo "  pm2 restart all"
echo "================================="
