#!/usr/bin/env bash
# Backup de PostgreSQL para Sistema de Turnos
# Uso: ./scripts/backup-db.sh [RETENTION_DAYS]
# Requiere: DATABASE_URL en .env o variable de entorno
# Retención por defecto: 7 días

set -e

RETENTION_DAYS="${1:-7}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Cargar .env si existe
if [ -f "$PROJECT_ROOT/apps/backend/.env" ]; then
  set -a
  source "$PROJECT_ROOT/apps/backend/.env"
  set +a
fi

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL no definida. Definir en .env o variable de entorno."
  exit 1
fi

# Parsear DATABASE_URL para pg_dump (postgres://user:pass@host:port/dbname)
# pg_dump acepta DATABASE_URL directamente en versiones recientes
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/backup_${TIMESTAMP}.sql.gz"

echo "[backup] Iniciando backup -> $BACKUP_FILE"
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$BACKUP_FILE"
echo "[backup] Backup completado: $(du -h "$BACKUP_FILE" | cut -f1)"

# Eliminar backups más viejos que RETENTION_DAYS
echo "[backup] Limpiando backups con más de $RETENTION_DAYS días..."
find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

echo "[backup] Listo. Retención: $RETENTION_DAYS días"
