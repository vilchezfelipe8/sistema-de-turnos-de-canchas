#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-sistema-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
DB_NAME="${POSTGRES_DB:-sistema}"
RUN_SEED="${RUN_SEED:-false}"
BACKEND_IMAGE="${BACKEND_IMAGE:-sistema-turnos-backend-local}"

RUNTIME_DB_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${DB_NAME}?schema=public}"
DIRECT_DB_URL="${DIRECT_DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${DB_NAME}?schema=public}"

if ! docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  echo "==> No existe $POSTGRES_CONTAINER. Levantando postgres desde docker compose..."
  docker compose -f "$COMPOSE_FILE" up -d postgres
  POSTGRES_CONTAINER="$(docker compose -f "$COMPOSE_FILE" ps -q postgres)"
else
  echo "==> Reutilizando contenedor PostgreSQL existente: $POSTGRES_CONTAINER"
  docker start "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
fi

echo "==> Esperando a PostgreSQL..."
until docker exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; do
  sleep 1
done

echo "==> Verificando base de datos \"$DB_NAME\"..."
if [[ "$(docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != "1" ]]; then
  docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"${DB_NAME}\";"
fi

echo "==> Probando permiso para CREATE EXTENSION btree_gist..."
docker exec "$POSTGRES_CONTAINER" psql -U "$POSTGRES_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS btree_gist;' >/dev/null

echo "==> Construyendo imagen Linux del backend para migrar de forma consistente..."
docker build -t "$BACKEND_IMAGE" "$SCRIPT_DIR" >/dev/null

echo "==> Ejecutando validate + migrate deploy dentro del contenedor Linux..."
docker run --rm \
  --network "container:${POSTGRES_CONTAINER}" \
  -e DATABASE_URL="$RUNTIME_DB_URL" \
  -e DIRECT_DATABASE_URL="$DIRECT_DB_URL" \
  "$BACKEND_IMAGE" sh -lc 'npx prisma validate && npx prisma migrate deploy'

echo "==> Generando cliente Prisma local..."
npx prisma generate

if [[ "$RUN_SEED" == "true" ]]; then
  echo "==> Ejecutando seed explícito..."
  docker run --rm \
    --network "container:${POSTGRES_CONTAINER}" \
    -e DATABASE_URL="$RUNTIME_DB_URL" \
    -e DIRECT_DATABASE_URL="$DIRECT_DB_URL" \
    -e ALLOW_SEED=true \
    "$BACKEND_IMAGE" sh -lc 'npx ts-node --transpile-only --compiler-options "{\"module\":\"CommonJS\"}" prisma/seed.ts'
fi

echo "✅ DB local lista."
echo "   DATABASE_URL runtime: $RUNTIME_DB_URL"
echo "   DIRECT_DATABASE_URL:  $DIRECT_DB_URL"
