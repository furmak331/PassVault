#!/bin/sh
# Runs as root only to hand the backup folder to the server's user, then as
# that user, so SQLite never leaves files in /data that the server can't open.
set -eu

if [ "$(id -u)" = 0 ]; then
  chown 10001:10001 /backups 2>/dev/null || true
  exec su-exec 10001:10001 "$0" "$@"
fi

KEEP=${BACKUP_KEEP:-14}
HOURS=${BACKUP_INTERVAL_HOURS:-24}
DB=/data/passvaultify.db

while true; do
  if [ -f "$DB" ]; then
    name="passvaultify-$(date +%Y-%m-%d-%H%M).db"
    if sqlite3 "$DB" ".backup '/backups/$name.part'"; then
      mv "/backups/$name.part" "/backups/$name"
      echo "Backed up to $name"
      # Keep the newest $KEEP.
      ls -1t /backups/passvaultify-*.db | tail -n +"$((KEEP + 1))" | xargs -r rm -f
    else
      rm -f "/backups/$name.part"
      echo "Backup failed; trying again next time" >&2
    fi
  else
    echo "No database yet; it appears once the server has started"
  fi
  sleep "$((HOURS * 3600))"
done
