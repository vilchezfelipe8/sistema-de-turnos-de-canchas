#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pique}"
RETENTION_DAYS="${1:-14}"
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo 'Retention must be a positive number of days.' >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo 'Another backup is running.' >&2; exit 1; }
cd "$PROJECT_ROOT"

BACKUP_FILE="$BACKUP_DIR/backup_$(date -u +%Y%m%d_%H%M%S).sql.gz"
TEMP_FILE="$(mktemp "$BACKUP_DIR/.backup.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT
docker compose -f docker-compose.production.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' \
  | gzip > "$TEMP_FILE"
gzip -t "$TEMP_FILE"
mv "$TEMP_FILE" "$BACKUP_FILE"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'backup_*.sql.gz' -o -name 'backup_*.secrets.tar.gz' \) -mtime +"$RETENTION_DAYS" -delete
printf '%s\n' "$BACKUP_FILE"
