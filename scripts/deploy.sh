#!/usr/bin/env bash
# Despliegue de Pique en el servidor a partir de imágenes ya publicadas en ghcr.io.
#
#   scripts/deploy.sh <tag>            # ej. scripts/deploy.sh 40f8024 (commit corto de main)
#   scripts/deploy.sh <tag> --dry-run  # muestra qué haría, sin tocar nada
#
# Pasos: backup de la base -> descarga de imágenes -> migraciones -> recrea servicios ->
# espera salud -> fija los tags en .env -> registra el despliegue.
# Volver atrás = correr el script con el tag anterior (queda en deployments.log).
# Ojo: las migraciones no se deshacen solas; para volver atrás una migración usar el backup.
set -Eeuo pipefail
umask 077

TAG="${1:-}"
DRY_RUN="${2:-}"
[[ "$TAG" =~ ^[0-9a-f]{7,40}$|^main$ ]] || { echo "Uso: $0 <commit-corto|main> [--dry-run]" >&2; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

REGISTRY_PREFIX="${PIQUE_IMAGE_PREFIX:-ghcr.io/vilchezfelipe8/pique}"
export BACKEND_IMAGE="${REGISTRY_PREFIX}-backend"
export FRONTEND_IMAGE="${REGISTRY_PREFIX}-frontend"
export BACKEND_RELEASE_TAG="$TAG"
export FRONTEND_RELEASE_TAG="$TAG"
COMPOSE=(docker compose -f docker-compose.production.yml)
APP_SERVICES=(backend backend-worker backend-scheduler frontend)
LOG_FILE="$PROJECT_ROOT/deployments.log"

exec 9>"$PROJECT_ROOT/.deploy.lock"
flock -n 9 || { echo 'Hay otro despliegue en curso.' >&2; exit 1; }

previous_tag="$(grep -E '^BACKEND_RELEASE_TAG=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
echo "==> Desplegando ${TAG} (anterior: ${previous_tag:-desconocido})"

run() {
  if [[ "$DRY_RUN" == "--dry-run" ]]; then echo "   [dry-run] $*"; else "$@"; fi
}

echo "==> Backup de la base"
run bash "$PROJECT_ROOT/scripts/backup-production.sh"

echo "==> Descargando imágenes"
run "${COMPOSE[@]}" pull "${APP_SERVICES[@]}"

echo "==> Migraciones"
run "${COMPOSE[@]}" run --rm --no-deps backend npx prisma migrate deploy

echo "==> Recreando servicios"
run "${COMPOSE[@]}" up -d --no-build "${APP_SERVICES[@]}"

if [[ "$DRY_RUN" != "--dry-run" ]]; then
  echo "==> Esperando que el backend quede sano"
  for _ in $(seq 1 40); do
    status="$("${COMPOSE[@]}" ps --format '{{.Health}}' backend 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && break
    sleep 3
  done
  [[ "$status" == "healthy" ]] || { echo "El backend no quedó sano (estado: ${status:-?}). Revisar: docker compose logs backend" >&2; exit 1; }
fi

# Nginx resuelve las IPs de backend/frontend al arrancar: tras recrearlos hay que recargarlo
# o sigue apuntando a los contenedores viejos (502 en /api).
echo "==> Recargando Nginx"
run "${COMPOSE[@]}" exec -T nginx nginx -s reload

if [[ "$DRY_RUN" != "--dry-run" ]]; then
  PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://pique.ar/api/health}"
  echo "==> Verificando ${PUBLIC_HEALTH_URL} desde afuera"
  code=""
  for _ in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$PUBLIC_HEALTH_URL" || true)"
    [[ "$code" == "200" ]] && break
    sleep 2
  done
  [[ "$code" == "200" ]] || { echo "La API pública no responde 200 (último: ${code:-?}). Revisar: docker compose logs nginx backend" >&2; exit 1; }
fi

echo "==> Fijando tags en .env"
set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env 2>/dev/null; then
    run sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    run sh -c "printf '%s=%s\n' '${key}' '${value}' >> .env"
  fi
}
set_env BACKEND_IMAGE "$BACKEND_IMAGE"
set_env FRONTEND_IMAGE "$FRONTEND_IMAGE"
set_env BACKEND_RELEASE_TAG "$TAG"
set_env FRONTEND_RELEASE_TAG "$TAG"

if [[ "$DRY_RUN" != "--dry-run" ]]; then
  printf '%s\t%s\tanterior=%s\tpor=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" "${previous_tag:-?}" "${DEPLOYED_BY:-$(whoami)}" >> "$LOG_FILE"
fi
echo "==> Listo: ${TAG} en producción"
