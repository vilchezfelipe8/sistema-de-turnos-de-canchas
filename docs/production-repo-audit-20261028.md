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

## Reconciliación del 30/10/2026

Se volvió a consultar producción por SSH, sin cambiar sus fuentes ni sus servicios.
`/opt/pique` continúa sin `.git`. Su registro de despliegue declara como base
`676b56766098a93aefd924b82b3b49e37b887ad1`, coincidente con el último commit remoto
disponible al comenzar la reconciliación.

Se compararon 803 archivos de fuentes y configuración con el árbol Git remoto.
Ningún archivo versionado faltaba en producción. Se consolidaron los ajustes de
infraestructura, bootstrap de Barrio Parque, correo, contraste y ayuda del login.
También se recuperaron hotfixes que todavía no estaban en Git:

- Separación criptográfica de tokens de invitación y sesión, con pruebas de tipos.
- Preflight de WhatsApp que acepta la versión de plantilla configurada por evento/rol,
  con su prueba de regresión.
- Estados neutrales de las opciones de ayuda del login y foco visible.

Los doce commits que adelantaban la rama remota se integraron mediante merge,
conservando los cambios locales de reservas mobile y el nuevo formulario de contraseña.
Se resolvieron conflictos de navegación en grilla, Mis reservas y checkout preservando
las mejoras remotas de historial/caché y confirmación.

La copia de producción conserva el formulario anterior de contraseña. Git conserva
su reemplazo local por el componente accesible `ChangePasswordForm`; esa diferencia
es intencional y queda pendiente de despliegue. Los SVG antiguos sobrantes de la copia
de producción ya fueron eliminados por la rama remota y no se reincorporaron.

Los archivos `.env`, secretos, respaldos, datos de socios y `DEPLOYMENT.json` siguen
fuera de esta consolidación de fuentes. No se inicializó Git en producción ni se
reconstruyeron imágenes, ejecutaron migraciones o reiniciaron servicios.

Esta regularización publica código en Git; el despliegue queda como operación separada.

Validación del código integrado:

- Frontend: build Next.js completo, con advertencias existentes de hooks/imágenes y Browserslist.
- Backend: generación de Prisma Client y compilación TypeScript completas.
- 40 pruebas backend aprobadas: correo, tipos de token, cambio de contraseña, reservas,
  checkout y preflight de WhatsApp.
- 12 pruebas frontend aprobadas: contraseña, filtros de deportes y errores de API.
- Compose de producción validado con variables de ejemplo, sin iniciar contenedores.
- Sintaxis Bash y PowerShell de los scripts de backup validada, sin ejecutar respaldos.
