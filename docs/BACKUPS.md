# Estrategia de Backups

## Mínimo requerido antes de producción

- **Frecuencia:** Backup diario
- **Retención:** 7 días mínimo
- **Almacenamiento:** Fuera del servidor de aplicación (S3, disco externo, etc.)

## Script incluido

```bash
./scripts/backup-db.sh [RETENTION_DAYS]
```

- `RETENTION_DAYS`: Días a conservar (default: 7)
- Requiere `DATABASE_URL` en `.env` o variable de entorno
- Salida: `backups/backup_YYYYMMDD_HHMMSS.sql.gz`

## Cron diario (ejemplo)

```cron
0 3 * * * cd /ruta/proyecto && ./scripts/backup-db.sh 7
```

## PITR (Point-in-Time Recovery) - Ideal

Para recuperación ante desastres más granular:

1. **PostgreSQL:** Habilitar WAL archiving (`archive_mode = on`, `archive_command`)
2. **Backup base:** Ejecutar `pg_basebackup` o backup lógico diario
3. **WAL:** Enviar segmentos WAL a S3 u otro storage
4. **Recuperación:** Restaurar base + replay WAL hasta el punto deseado

### Variables típicas para PITR

```ini
# postgresql.conf
archive_mode = on
archive_command = 'cp %p /path/to/wal_archive/%f'
# o con aws s3 cp para S3
```

## Restauración

```bash
gunzip -c backups/backup_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL"
```

**Importante:** Hacer backup antes de aplicar migraciones destructivas o cambios de schema mayores.
