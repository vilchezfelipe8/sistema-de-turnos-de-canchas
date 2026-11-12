# Pipeline de despliegue (CI → imágenes → deploy)

Objetivo: que lo que corre en producción sea siempre un commit de `main`, sin compilar en el
servidor ni cambios a mano, y que desplegar o volver atrás sea un botón.

## Cómo funciona

1. **CI** (`.github/workflows/ci.yml`): en cada PR y cada push a `main` corre typecheck, tests y
   build del backend y del frontend. No publica nada.
2. **Images** (`.github/workflows/images.yml`): en cada merge a `main` construye las imágenes y las
   publica en GitHub Container Registry:
   - `ghcr.io/vilchezfelipe8/pique-backend:<commit-corto>` (y `:main`)
   - `ghcr.io/vilchezfelipe8/pique-frontend:<commit-corto>` (y `:main`)
3. **Deploy** (`.github/workflows/deploy.yml`): manual. Se elige el commit, pide aprobación
   (environment `production`), entra por SSH y corre `scripts/deploy.sh <commit>`:
   backup → `docker compose pull` → `prisma migrate deploy` → `up -d` → espera salud →
   fija los tags en `.env` → registra en `deployments.log`.

Volver atrás: correr Deploy con el commit anterior (figura en `deployments.log`).
Las migraciones no se deshacen solas: si una migración rompe, restaurar el backup que
`deploy.sh` genera antes de migrar.

## Puesta en marcha (una sola vez)

### En GitHub
1. Mergear este PR. El workflow Images publica las primeras imágenes de `main`.
2. Settings → Environments → **New environment** `production` → *Required reviewers*: quienes
   pueden aprobar un despliegue.
3. Settings → Secrets and variables → Actions → **New repository secret**:
   - `DEPLOY_HOST`: `200.141.23.247`
   - `DEPLOY_USER`: usuario del servidor (ideal: uno `deploy` con acceso a docker, no `root`)
   - `DEPLOY_SSH_KEY`: clave privada nueva, solo para GitHub Actions
     (`ssh-keygen -t ed25519 -C github-actions-deploy -f deploy_key -N ""`)
   - `DEPLOY_KNOWN_HOSTS`: salida de `ssh-keyscan 200.141.23.247`

### En el servidor (`/opt/pique`)
1. Agregar la clave pública (`deploy_key.pub`) a `~/.ssh/authorized_keys` del usuario de deploy.
2. No hace falta login en ghcr.io: el workflow Deploy le pasa al servidor el token temporal del
   job (solo lectura, vence al terminar) y hace logout al final.
3. Copiar desde `main` los archivos nuevos: `scripts/deploy.sh` y `docker-compose.production.yml`.
   Antes, comparar el compose con el actual del servidor (puede tener ajustes locales).
4. Probar sin tocar nada: `scripts/deploy.sh <commit> --dry-run`.
5. Primer despliegue real desde GitHub (Actions → Deploy).

### Después
- `/opt/pique` deja de necesitar el código: alcanza con el compose, `scripts/`, `nginx/`, los `.env`
  y `secrets/`. No editar código en el servidor: todo cambio entra por PR a `main`.
- Hasta que esto esté activo, el despliegue manual anterior (build en el servidor) sigue
  funcionando igual: sin `BACKEND_IMAGE`/`FRONTEND_IMAGE` el compose usa `pique-*:local`.

## Pendiente antes del primer deploy con este pipeline
`main` está ~125 commits por delante de lo desplegado (base `676b567`, 29/10) y trae 9 migraciones.
Revisar en especial `20260610120000_add_fiscal_module`: tiene fecha de junio pero se agregó después
de migraciones ya aplicadas en producción, así que corre "fuera de orden".
