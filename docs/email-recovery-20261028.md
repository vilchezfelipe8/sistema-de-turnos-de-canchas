# Restauración de correo — 28/10/2026

Producción no tenía `RESEND_API_KEY` ni `EMAIL_FROM` en el entorno del backend.
La configuración local conservaba una clave de envío válida, pero su remitente
anterior era `login@auth.pique.app`. La clave está restringida al dominio
`pique.ar`, verificado en Resend.

Se restauró la clave existente en `apps/backend/.env` del servidor y se configuró
`EMAIL_FROM="Pique <login@pique.ar>"`. El secreto no está en Git ni en esta documentación.
Se comprobó que esas son las únicas dos variables modificadas en el backend.

Se corrigió `AuthEmailService` para revisar `{ data, error }` de Resend tanto en
magic links como en códigos de activación/recuperación. Un rechazo del proveedor
ahora produce un error real; una respuesta sin identificador tampoco cuenta como
envío exitoso. Las aceptaciones registran únicamente el ID de correo, sin códigos
ni enlaces de acceso. La versión de texto del magic link incluye ahora la URL.

Validación:

- Cinco pruebas de correo aprobadas, incluyendo rechazo, respuesta incompleta y
  aceptación para ambos métodos de envío.
- Build correcto y backend/API, worker y scheduler saludables, sin reinicios.
- Solicitud real a `POST /api/auth/email/request-link`: HTTP 200.
- Un único correo de prueba al destinatario autorizado por el operador.
- ID de Resend: `01a18362-bded-7a7a-8a9a-0186783a2444`.
- Panel de Resend: `Delivered`. No se afirmó ni comprobó su ubicación dentro de Gmail.

Imagen backend: `pique-backend:ab524ac-mail-20261028-1640`.
Frontend conservado: `pique-frontend:ab524ac-20261027-2109`.
El resto del código remoto, incluido el arreglo del token de invitación, se conservó.
No hubo migraciones ni seeds.

Backups descargados a esta PC con sus secretos:

- Previo: `backup_20261028_163636.sql.gz`.
- Posterior: `backup_20261028_164215.sql.gz`.

Rollback, código previo y configuración privada:
`/var/backups/pique/releases/ab524ac-mail-20261028-1640/`.
Manifiesto, parche y reporte de prueba local:
`C:/Users/franc/Backups/Pique/releases/ab524ac-mail-20261028-1640/`.
La clave reutilizada y el remitente están respaldados en
`C:/Users/franc/Backups/Pique/.config/resend-production.json`, fuera del repositorio.

Parche local pendiente de commit/push: servicio de correo y sus pruebas.
