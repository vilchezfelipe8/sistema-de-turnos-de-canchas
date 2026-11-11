# Contraste de avisos verdes — 28/10/2026

El aviso de éxito del login usaba `--brand-hover` (lima claro) sobre un fondo casi
blanco. El contraste medido era aproximadamente 1,15:1.

Se usan ahora los tokens semánticos `--positive-bg` y `--positive-fg`: texto verde
oscuro sobre fondo claro en modo claro, y lima sobre fondo oscuro en modo oscuro.
Contraste calculado: 5,92:1 en claro y 9,33:1 en oscuro (fondo alfa compuesto sobre
la tarjeta). También se corrigen el enlace de invitaciones, el enlace Ver reservas
en perfil y los iconos de confirmación de AppModal.

La copia local de BookingGrid conserva un modal de ingreso que ya no está en la
versión de producción. Se corrigió su aviso local, sin reemplazar BookingGrid en
el servidor ni restaurar el flujo anterior.

## Verificación

- Flujo real de activación en frontend local con API simulada, sin acceso al
  backend real ni envío de códigos o correos. DNI de prueba 00000000.
- Colores calculados del navegador comprobados en claro y oscuro.
- Captura visual del aviso de activación en claro.
- `git diff --check` sin errores.
- Revisión React: cambios limitados a colores y fondos, sin nuevos efectos,
  dependencias, llamadas de red o cambios de estado.

## Despliegue

Release frontend publicada: `pique-frontend:ab524ac-contrast-20261028`.
Build ID: `ANDzloGtG-AguXgoB8UtG`. Compilación de Next.js, revisión de tipos y lint
completados; permanecen avisos preexistentes de hooks e imágenes.
Login público HTTP 200 y API de salud OK. Verificados los mismos IDs de
contenedores de backend, worker y scheduler antes y después del despliegue.
Se construye sobre el código actual del servidor, con comprobación SHA-256 de los
cuatro archivos antes de aplicar cinco reemplazos precisos. Se mantienen las
imágenes y los contenedores de backend, worker y scheduler.

Snapshot y parche del servidor:
`/var/backups/pique/releases/ab524ac-contrast-20261028/`.
Copia local: `C:/Users/franc/Backups/Pique/releases/ab524ac-contrast-20261028/`.
El script permite restaurar la imagen anterior si falla la comprobación de salud.
La comprobación inicial apuntaba al puerto 3001; se corrigió a 3000 y se completó
con `pique-contrast-finalize-20261028.sh`. No hubo cambios de datos ni envíos reales
durante las pruebas.
