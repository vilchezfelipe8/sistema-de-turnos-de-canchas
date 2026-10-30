# Auditoría de producción contra Git — 28/10/2026

Se consultó origin/feature/new-club mediante fetch, sin modificar el checkout.
La rama remota apunta a ab524ac2440c9e367e44a6b580141ff8cf1d4370. El checkout
local está en 79cec81002450dd2de0fc7295bb44f8954b1ad55, diez commits detrás,
y contiene cambios locales pendientes.

Producción en /opt/pique no tiene .git: es una copia de fuentes usada para
construir imágenes Docker. DEPLOYMENT.json registra su base y los hotfixes.
Release frontend actual: ab524ac-help-choice-20261028.
Release backend actual: ab524ac-mail-20261028-1640.

## Comparación completa

Se comparó el hash de blob de cada uno de los 786 archivos del árbol remoto
contra las fuentes de producción:

- 765 idénticos.
- 21 modificados.
- Ningún archivo versionado ausente.
- 17 archivos adicionales de código, configuración y documentación, además
  del registro DEPLOYMENT.json (18 extras en total).

El delta consolidado contiene 38 rutas, con 1250 líneas añadidas y 30 eliminadas.
No es solo código de aplicación: incluye guías, scripts de backup y despliegue.

Áreas pendientes de reconciliar: infraestructura Hostinger (Docker, Compose,
nginx y backups); acceso y cambio de contraseña; separación entre token de
invitación y token de sesión; errores del proveedor de correo; preflight de
WhatsApp y sus tests; contraste de avisos y opciones de ayuda del login.

DEPLOYMENT.json enumera cuatro parches fuera del repo. Esa lista no captura
todos los cambios: se debe usar la comparación completa para reconciliar.

## Respaldo para reconciliación

Carpeta privada local:
C:/Users/franc/Backups/Pique/diagnosticos/repo-audit-20261028/

- pique-production-audit-20261028.json: manifiesto y diferencias.
- pique-production-repo-delta-20261028.tar.gz: las 39 rutas de producción.
- production-vs-origin-ab524ac.patch: diferencias normalizadas, sin el registro
  de despliegue ni archivos .env.
- diff-stats.json: tamaño del cambio por archivo.

SHA-256 del archivo tar:
42cf1d4b1a9a3f8a522fb82f3b3bc1c0bb653dd61c2fa72fd5da10655bb99fd0

No se realizaron cambios en producción durante esta auditoría. No se crearon
commits ni se subió nada a GitHub. Las credenciales, archivos .env, datos de socios
y backups de la base deben permanecer fuera del repositorio.

## Regularización

Integrar los diez commits remotos preservando los cambios locales; reconciliar
las 38 rutas con los tests locales adicionales; separar infraestructura, seguridad
y producto en commits revisables; validar y subir la rama; reconstruir las imágenes
desde el commit resultante y registrar ese commit como base de producción.
