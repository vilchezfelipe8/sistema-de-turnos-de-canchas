# Opciones de ayuda del login — 28/10/2026

La opción Recibir un link para entrar usaba la clase lg-help-option-main, con
fondo, borde e icono verdes desde el inicio. No era una selección real, pero
parecía estar activada antes de interactuar.

Las tres opciones ahora comparten el mismo estilo neutro. El hover cambia a un
fondo neutro algo más intenso y el foco de teclado usa un contorno explícito.
Se conservan los textos y los manejadores de cada acción.

El cambio se aplica al login actual de producción, con SHA-256 previo
a08396193705c219ea51ca23ca70498a16d6b42d80710c8761441f1bc4fd31f5.
La copia local del login aún no contiene este nuevo menú; no se reemplaza con
una versión completa del servidor para evitar mezclar cambios de otras versiones.

Parche para reaplicar sobre esa versión del login:
`patches/pique-help-choice-20261028.patch` (relativo al repositorio).

Release frontend: pique-frontend:ab524ac-help-choice-20261028.
Snapshot y parche: /var/backups/pique/releases/ab524ac-help-choice-20261028/.
Copia local: C:/Users/franc/Backups/Pique/releases/ab524ac-help-choice-20261028/.
El backend, sus procesos y datos se conservan.

Publicado y verificado: build JxUnMsrClI-_DidgGlFlU, login HTTP 200 y API de salud
OK. En el navegador las tres opciones tienen el mismo fondo, borde y color de
iconos al abrir la ayuda. Navegar con Tab enfoca la primera opción y muestra el
contorno de 2 px, sin activar el envío. Captura guardada de la pantalla publicada.
