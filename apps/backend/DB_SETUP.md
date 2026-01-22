# Configuración de Base de Datos

## Opción 1: Script NPM (Recomendado)

Desde el directorio `apps/backend`, ejecuta:

```bash
npm run db:setup
```

Este comando hace todo automáticamente:
- Elimina el contenedor anterior (si existe)
- Crea y inicia el contenedor de PostgreSQL
- Espera a que la base de datos esté lista
- Sincroniza el esquema de Prisma
- Genera el Prisma Client
- Ejecuta el seed

## Opción 2: Scripts de Shell

### Linux/Mac/Git Bash:
```bash
cd apps/backend
chmod +x setup-db-simple.sh
./setup-db-simple.sh
```

### Windows (CMD):
```bash
cd apps\backend
setup-db.bat
```

O desde npm:
```bash
npm run db:setup:win
```

## Opción 3: Comandos Manuales

Si prefieres ejecutar los comandos manualmente:

```bash
# 1. Eliminar contenedor anterior (si existe)
docker rm -f sistema-postgres

# 2. Crear y ejecutar contenedor de PostgreSQL
docker run -d --name sistema-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=1234 \
  -e POSTGRES_DB=sistema_turnos \
  -p 5432:5432 \
  postgres:15

# 3. Esperar unos segundos para que PostgreSQL inicie
# (o esperar manualmente)

# 4. Desde apps/backend, sincronizar esquema
cd apps/backend
npx prisma db push --accept-data-loss

# 5. Generar Prisma Client
npx prisma generate

# 6. Ejecutar seed
npx prisma db seed
```

## Comandos Útiles

### Resetear base de datos completamente:
```bash
npm run db:reset
```

### Solo sincronizar esquema (sin recrear contenedor):
```bash
npm run db:push
```

### Solo ejecutar seed:
```bash
npm run db:seed
```

## Notas

- Asegúrate de tener Docker instalado y corriendo
- El contenedor usa el puerto `5432` - verifica que no esté en uso
- Los datos se pierden al eliminar el contenedor (es normal en desarrollo)
- Para producción, usa migraciones en lugar de `db push`
