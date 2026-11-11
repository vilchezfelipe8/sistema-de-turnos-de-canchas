# Reconstrucción Hostinger — 2026-10-22

Servidor: `200.141.23.247` (`srv2087396`), Ubuntu 24.04 LTS.
Proyecto remoto: `/opt/pique`. Código base actual: `79cec81002450dd2de0fc7295bb44f8954b1ad55`, rama `feature/new-club`, más ajustes locales de despliegue y WhatsApp.
Release activo: `79cec81-20261022-2138`. Procedencia e imágenes verificables en `/opt/pique/DEPLOYMENT.json`.

## Instalación en iPhone

Pull fast-forward desde `7897d57` a `79cec81`, con cambios locales respaldados en
stash `2c8b745ca0b05cd9a3cb476d63ae1d27b7c48644` y restaurados sin conflictos.
El commit corrige las instrucciones de instalación para Safari/Chrome/otros en iOS
y entrega el manifest, el título y el ícono de Apple desde el HTML inicial del club.

Se actualizó el frontend a `pique-frontend:79cec81-20261022-2138`.
Los tres contenedores de backend conservan su imagen y sus identificadores:
`pique-backend:7897d57-20261022-2000-whatsapp-20261022-202735`.
El backend no cambia en este commit; se preservó la actualización de WhatsApp
que ya estaba activa. Copia de sus fuentes guardada en el respaldo del release.

Compose admite ahora `FRONTEND_RELEASE_TAG` y `BACKEND_RELEASE_TAG` por separado,
con `RELEASE_TAG` como respaldo. El `.env` remoto fija los tags efectivos para que
un futuro `docker compose up` conserve la combinación desplegada.

Build correcto y seis comprobaciones de detección de navegadores aprobadas.
En producción se verificó el HTML inicial con user-agent de Safari/iPhone:
un único manifest de Barrio Parque, título del club y apple-touch-icon de 180 px.
El manifest sin parámetro de nombre obtiene el nombre real desde backend;
el ícono responde como PNG de 180 × 180. API saludable y cero reinicios.
Comparación de datos antes/después idéntica: 44 clientes/socios activos vinculados,
44 memberships CUSTOMER y 46 usuarios totales. No hubo migraciones ni seeds.
Build ID del frontend: `4O_vGxaT2lKhYXI83Nn94`.

Backups descargados a esta PC: previo `backup_20261022_213514.sql.gz` y posterior
`backup_20261022_214107.sql.gz`, con sus secretos. Fuentes previas, imágenes reales,
HTML de comprobación y rollback en `/var/backups/pique/releases/79cec81-20261022-2138/`.
Delta, manifiesto y fuentes preservadas de backend también guardados en
`C:/Users/franc/Backups/Pique/releases/79cec81-20261022-2138/`.

## Acceso directo por club

Se desplegó `7897d57`: acceso directo instalable por club, nombre e ícono propios,
inicio y navegación para la app instalada, y accesos a los clubes del usuario.
Se conserva el cambio de contraseña y la configuración local de producción.
El frontend recibe `INTERNAL_API_URL=http://backend:3000` para consultar el logo
desde el generador del ícono. Nginx mantiene las rutas `/club-app/*` en frontend.

Build de backend/frontend correcto y 14 pruebas de reservas/cambio de contraseña
aprobadas. Dos pruebas de reservas usaban fechas de junio ya vencidas: el fixture
ahora usa una fecha relativa futura y se verifica también el logo del DTO.
No se agregaron migraciones ni se ejecutaron seeds.

Verificación en producción: API saludable, manifest con inicio en Barrio Parque,
PNG de 512 × 512 con el logo real del club y botón Instalar app visible.
La comparación antes/después confirma 44 socios/clientes y sus 44 cuentas vinculadas
sin cambios. Los cuatro contenedores de aplicación usan el tag nuevo, sin reinicios.
Build ID del frontend: `wRcqOKwwhFXPIMdlSWIaW`.

Backup previo: `backup_20261022_195839.sql.gz`, descargado con sus secretos a esta PC.
Backup posterior: `backup_20261022_200456.sql.gz`, también descargado con sus secretos.
Rollback disponible con las imágenes `346175e-socios-20261022-1950` y el respaldo
de código/configuración en `/var/backups/pique/releases/7897d57-20261022-2000/`.
Archivo delta, manifiesto y comprobaciones en
`C:/Users/franc/Backups/Pique/releases/7897d57-20261022-2000/`.

## Carga de socios y cambio de contraseña

Se importaron 44 socios de Barrio Parque con sus clientes, cuentas MEMBER activas
y memberships CUSTOMER. Detalle y trazabilidad en [importacion-socios-barrio-parque.md](importacion-socios-barrio-parque.md).
La contraseña inicial compartida está fuera del repositorio. No se modificó la cuenta admin.
El release actual agrega cambio de contraseña autenticado en Perfil > Seguridad,
sin depender de correo o WhatsApp. Pasaron 18 pruebas de socios, autenticación y
cambio de contraseña; TypeScript y build de ambos servicios correctos.
No se cambiaron migraciones ni configuración de Mercado Pago.

Backup previo: `backup_20261022_194333.sql.gz`; posterior: `backup_20261022_194946.sql.gz`,
ambos descargados a esta PC con sus secretos. Las imágenes del release anterior
`346175e-20261022-155059` se conservan; respaldo de código anterior y `.env` en
`/var/backups/pique/releases/346175e-socios-20261022-1950/`.

## Actualización del 2026-10-22

Pull fast-forward desde `81702ab` hasta `346175e`, incluyendo:

- `1a8ff1a`: reorganización de confirmación de reserva e invitación a jugador.
- `346175e`: ventanas de reserva con prioridad para socios.

Configuración local preservada antes del pull en stash `2021f393b93de93424a0f69d309193ce82dadd3f`
y restaurada sin conflictos. El stash se conserva como respaldo.
Build de frontend y backend correcto; 27 pruebas simuladas de ventanas, checkout, OAuth y webhook aprobadas.
Migración `20261019120000_add_booking_release_policy` aplicada: agrega JSONB nullable en ClubSettings.
Frontend, API, worker, scheduler y Nginx recreados con la nueva versión. La política de reservas conserva
su estado guardado (deshabilitada si no fue configurada).
Verificación final: login admin desde Chrome y pantalla Ajustes > Reservas con sección Ventanas de reserva
cargada y controles habilitados. API de salud y endpoint público de ventanas responden correctamente;
los cinco contenedores de aplicación están ejecutándose sin reinicios. Backup posterior descargado:
`backup_20261022_185726.sql.gz` y secretos correspondientes.

Rollback de aplicación disponible: imágenes `81702ab-rebuild`, más copia del código y `.env` anteriores
en `/var/backups/pique/releases/346175e-20261022-155059/`.
El campo nuevo de base es compatible con las imágenes anteriores; no requiere borrar datos para volver atrás.
Backup externo previo a la migración: `backup_20261022_185055.sql.gz` y secretos correspondientes
en `C:\Users\franc\Backups\Pique`. Paquete completo y manifiesto del release también guardados en `releases/`.

## Operación

El archivo remoto `.env` define `COMPOSE_FILE=docker-compose.production.yml`.
Los secretos viven en `.env`, `apps/backend/.env` y `secrets/barrio-parque.env`, con permisos `0600`.
No copiar estos archivos a Git ni incluirlos en imágenes Docker.

```bash
cd /opt/pique
docker compose ps
docker compose logs --tail=100 backend backend-worker backend-scheduler
docker compose build backend frontend
docker compose run --rm --no-deps backend npx prisma migrate deploy
docker compose up -d
```

Las migraciones deben completarse antes de iniciar una nueva versión del backend.
No ejecutar `db push` ni `down -v` en este servidor.

## Base inicial

Se usa un bootstrap exclusivo para Barrio Parque. No ejecutar el seed general:
incluye otros clubes, usuarios de prueba y contraseñas conocidas.

```bash
cd /opt/pique
docker compose run --rm --no-deps --env-from-file secrets/barrio-parque.env backend npm run bootstrap:barrio-parque
```

Crear únicamente Barrio Parque, administrador `admin@barrioparque.com` con membresía OWNER,
actividad Tenis, cuatro canchas, siete productos y Caja Principal sin turno abierto ni saldo de prueba.
Precios, stock y datos de contacto provienen del seed proporcionado; verificar antes de operar.
Repetir el bootstrap conserva contraseña, stock y configuración existentes.

## DNS y HTTPS

Apuntar registros A de `pique.ar` y `www.pique.ar` a `200.141.23.247`.
Un CNAME de `www` hacia `pique.ar` también sirve.
Eliminar o corregir registros AAAA antiguos si existen. No cambiar registros MX/TXT de correo.

El proxy inicia con `nginx/bootstrap.conf`: publica el challenge ACME y devuelve 503 en el resto del sitio.
Después de verificar ambos dominios contra este VPS:

```bash
certbot certonly --webroot -w /var/www/certbot \
  -d pique.ar -d www.pique.ar --non-interactive --agree-tos --register-unsafely-without-email
cd /opt/pique
sed -i 's|^NGINX_CONFIG=.*|NGINX_CONFIG=./nginx/production.conf|' .env
docker compose up -d --force-recreate nginx
docker compose exec -T nginx nginx -t
certbot renew --dry-run
```

Instalar hook de renovación `/etc/letsencrypt/renewal-hooks/deploy/pique-nginx`:

```bash
#!/bin/sh
cd /opt/pique || exit 1
docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload
```

Aplicar permiso ejecutable al hook. Certbot usa su timer de systemd.

## Backups

```bash
cd /opt/pique
bash scripts/backup-production.sh 14
```

Destino local del servidor: `/var/backups/pique`. No alcanza como única copia externa.
Programación instalada: `/etc/cron.d/pique-backup`, a las 06:00 UTC (03:00 Argentina), con retención de 14 días.

Copia externa autorizada: `C:\Users\franc\Backups\Pique`, retención de 90 días.
La tarea Windows `Pique-Backup-Hostinger` se ejecuta diariamente a las 10:00 (hora local),
y al iniciar sesión si todavía no se descargó una copia ese día. Requiere PC encendida,
sesión de Francisco iniciada y conexión a Internet. Recupera ejecuciones pendientes y reintenta
hasta tres veces, cada 30 minutos, si falla.

La tarea usa Windows PowerShell del sistema, sin depender de Codex abierto ni del checkout.
Copias de `scripts/backup-to-windows.ps1` y `scripts/scheduled-backup.ps1` se instalaron en
`C:\Users\franc\Backups\Pique\.scripts`. Si se modifican, actualizar también esas copias.
Logs: `backup.log` y `scheduled-task.log` en la carpeta de backups.

Cada descarga crea un dump `.sql.gz` y un archivo `.secrets.tar.gz` con variables de entorno
y credencial inicial de bootstrap. Ambos archivos deben conservarse privados.
Acceso inicial: `C:\Users\franc\Backups\Pique\acceso-administrador.txt`.

Restauración probada en una base separada: 1 club, 4 canchas, 7 productos, 1 usuario,
0 turnos de caja y 0 reservas. Esa base temporal se eliminó después de verificarla.

## Integraciones

WhatsApp y Mercado Pago quedan deshabilitados durante la reconstrucción.
Correo requiere verificar credenciales y dominio remitente antes de usar enlaces de acceso.
Login por email y contraseña funciona sin estas integraciones.

### Mercado Pago: configuración en curso

El usuario confirmó que existe una aplicación de Pique en Mercado Pago Developers.
No se encontraron credenciales OAuth de Mercado Pago en las variables locales recuperadas.
Plantilla privada preparada fuera del repositorio:
`C:\Users\franc\Backups\Pique\.config\mercadopago.env`.

Configurar la aplicación existente con:

- OAuth redirect URI: `https://pique.ar/api/integrations/mercadopago/callback`
- Webhook: `https://pique.ar/api/webhooks/mercadopago`
- Credenciales backend: App ID numérico / Client ID, Client Secret y firma secreta del webhook.

`INTEGRATION_SECRETS_KEY` ya existe en el servidor: conservarla para poder descifrar tokens del club.
Faltan login en Developers, carga de credenciales, conexión OAuth de la cuenta del club y validación de webhook.
Mantener `MERCADO_PAGO_ENABLED=false` y checkout del club apagado hasta completar la preparación.

Validación previa: 18 pruebas simuladas de OAuth, preferencias, checkout y webhook aprobadas
en contenedor separado con conexiones de base de datos apuntando a un destino inaccesible.
Se corrigieron fechas vencidas y el mock faltante de ClubSettings en las pruebas de checkout;
se verificó también que un club con checkout apagado no pueda crear preferencias de pago.
Estas pruebas no sustituyen la validación con credenciales y webhook reales.

## Verificación realizada

- Build de backend y frontend sobre Node 22, con TypeScript y lint aprobados (warnings preexistentes).
- 52 migraciones aplicadas, esquema actualizado.
- DNS de ambos dominios actualizado en Cloudflare, sin modificar registros de correo.
- HTTPS con certificado válido de Let's Encrypt y redirección de www al dominio principal.
- Renovación automática habilitada y simulación de renovación de ambos dominios completada correctamente.
- Health de API con PostgreSQL conectado; frontend público visible desde Chrome.
- Prueba por HTTPS: login admin, acceso autenticado a canchas/productos, CSRF, refresh y logout.
- Bootstrap repetido sin duplicar datos ni cambiar contraseña.
- Backup comprimido descargado a Windows y restaurado correctamente.
- Tarea Windows ejecutada y último resultado verificado como 0 (éxito).
- PostgreSQL, Redis y PgBouncer accesibles solo desde red interna de contenedores.

Segunda clave SSH instalada para Felipe (`felipe@DESKTOP-SJUSKPD`):
`SHA256:FnF06hqAeULIbOTBLgrBv2OZ+L1q2lGRY1VxvdRBIRE`.
Acceso: `ssh root@200.141.23.247`. Ingreso desde el equipo de Felipe confirmado por el usuario.
