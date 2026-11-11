# Carga de socios de Barrio Parque — 2026-10-22

Fuente: `E:/Descargas/Listado_socios_nueva.xlsx`, hoja `Socios`, filas 2 a 45.
SHA-256: `f8d0db19565ed006764b57495fa7965eec0a6b5cd9c9878f98672c7da7cfed11`.

Se verificaron 44 DNI únicos y 44 celulares. Se normalizaron los celulares argentinos
a formato internacional. El archivo original no se modificó.

La previsualización del importador existente devolvió 44 altas y 44 cuentas nuevas,
sin conflictos ni errores. Antes de escribir se descargó el backup
`backup_20261022_194333.sql.gz` y su archivo de secretos a esta PC.

La carga se aplicó en una transacción Serializable. Se exigió que el club no tuviera
clientes ni socios y que ningún DNI ya perteneciera a una cuenta. Ante cualquier
conflicto se revertía toda la transacción. No se modificó la cuenta administradora.

Resultado: 44 clientes, 44 socios activos de la categoría existente `ACTIVO`
(Socio activo), 44 cuentas MEMBER activas y 44 memberships CUSTOMER del club
`club-atletico-barrio-parque` (id 1). Cada cliente está vinculado a su cuenta.
Se comprobaron las 44 contraseñas iniciales con bcrypt y los 44 vínculos.

La planilla no informa categoría, vencimiento, cuotas ni fecha histórica de alta.
Se usó la categoría existente, alta del día de importación y sin vencimiento.
No se generaron pagos, deudas, reservas ni números de socio a partir de la columna
`N°`, que contiene una secuencia de orden del listado.

Por pedido del operador, las nuevas cuentas comparten una contraseña inicial.
Se guardó un hash bcrypt con sal diferente para cada cuenta. La contraseña y los
reportes con datos personales están fuera del repositorio, bajo
`C:/Users/franc/Backups/Pique/imports/socios-20261022/`.
`commit.json` contiene los identificadores creados y la fila de origen;
`credentials.json` contiene la contraseña inicial. No subir estos archivos a Git.

El ingreso usa DNI (sin puntos) y contraseña en `/login`. El cambio voluntario de
contraseña se realiza desde `/perfil`, sección Seguridad. Requiere la contraseña
actual, una nueva de al menos 8 caracteres y confirmación en el formulario.
El endpoint `POST /api/auth/password/change` exige sesión, CSRF y límite de intentos;
guarda el hash y revoca las sesiones anteriores en una transacción, luego emite
una sesión nueva. No depende de correo ni WhatsApp y no impone cambio obligatorio
en el primer ingreso.
