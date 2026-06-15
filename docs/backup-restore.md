# Backup y restore operativos

Esta guía deja un camino mínimo para backupear y restaurar la base del club sin depender de conocimiento tribal.

## 1. Backup recomendado

- Frecuencia mínima: diaria
- Retención mínima: 7 días
- Destino: fuera del servidor de aplicación
- Antes de migraciones sensibles: ejecutar un backup manual

Script disponible:

```bash
./scripts/backup-db.sh 7
```

Salida esperada:

```txt
backups/backup_YYYYMMDD_HHMMSS.sql.gz
```

## 2. Programación sugerida

Ejemplo de cron diario a las 03:00:

```cron
0 3 * * * cd /ruta/proyecto && ./scripts/backup-db.sh 7
```

## 3. Restore

Restaurar un backup lógico:

```bash
gunzip -c backups/backup_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL"
```

## 4. Checklist de restore

1. Restaurar en una base separada o entorno staging primero.
2. Verificar tablas críticas:
   - `User`
   - `Membership`
   - `Booking`
   - `Account`
   - `Payment`
   - `CashShift`
3. Validar login admin y acceso a un club real.
4. Validar una reserva de lectura, una cuenta y un reporte.
5. Documentar fecha, backup usado y resultado del restore test.

## 5. Recomendación operativa

- Hacer un restore test al menos una vez por mes.
- Guardar evidencia del último restore exitoso.
- Si la infraestructura lo permite, complementar con PITR/WAL archival.

La estrategia resumida de backups también vive en `/Users/francisco/Documentos Local/Proyectos/sistema-de-turnos-de-canchas/docs/BACKUPS.md`.
