# Agente del molinete

Programa chico que corre en la PC del kiosco. Cuando el kiosco de Pique (`/admin/kiosco`)
deja pasar a alguien, le pide a este agente que abra el molinete. El agente cierra un relé
USB unos milisegundos, como si alguien apretara el botón de "abrir" del molinete.

- Windows PowerShell 5.1 (viene con Windows 10/11). No hay que instalar nada más.
- Escucha solo en `127.0.0.1` (no se ve desde la red).
- Solo acepta pedidos de páginas de `allowedOrigins` (por defecto `https://pique.ar`).
  Otra página abierta en esa PC no puede abrir el molinete.

## Hardware

Un relé USB de 1 canal. El más común y barato es el **LCUS-1** (chip CH340, se ve como
puerto COM). Windows 10/11 suele instalar el driver solo.

Cableado: los bornes **COM** y **NO** del relé van en paralelo con la entrada de "abrir
entrada" del controlador del molinete (la misma que hoy activa AccesoGym o el pulsador).
El relé es un contacto seco: no le manda tensión al molinete, solo cierra el circuito.

> Antes de cablear, confirmá en el manual del controlador qué bornes liberan un paso de
> entrada y que aceptan contacto seco. Si el molinete es de otro proveedor, que lo haga el técnico.

Otros relés: si el relé es HID (los "USB Relay" que no aparecen como COM), se usa
`"type": "command"` con el programa del fabricante (ver abajo).

## Instalar

1. Copiar la carpeta `tools/molinete` a la PC del kiosco.
2. En esa carpeta, clic derecho → "Abrir en Terminal" y correr:

   ```powershell
   powershell -ExecutionPolicy Bypass -File instalar.ps1
   ```

   Queda en `%LOCALAPPDATA%\PiqueMolinete` y arranca solo al iniciar sesión.
   Empieza en modo `simulate` (no abre nada).
3. Ver en qué puerto quedó el relé:

   ```powershell
   powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\PiqueMolinete\pique-molinete.ps1" -ListPorts
   ```

4. Editar `%LOCALAPPDATA%\PiqueMolinete\config.json`: `"type": "serial"` y `"comPort"` con ese puerto.
5. Volver a correr `instalar.ps1` (reinicia el agente con la config nueva; la config no se pisa).
6. Probar el relé sin el kiosco:

   ```powershell
   powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\PiqueMolinete\pique-molinete.ps1" -Test
   ```

   (El agente tiene que estar detenido, o usar otro `port` para la prueba.)
7. En el kiosco: ruedita → "Agente del molinete" → `http://127.0.0.1:7788` → "Probar".
   Chrome puede preguntar si pique.ar puede acceder a dispositivos de la red local: **Permitir**.

Desinstalar: `powershell -ExecutionPolicy Bypass -File instalar.ps1 -Desinstalar`.

## config.json

| Campo | Qué es |
|---|---|
| `port` | Puerto local (7788). |
| `pulseMs` | Cuánto tiempo queda cerrado el relé (600 ms). Subilo si el molinete no llega a liberar. |
| `allowedOrigins` | Páginas que pueden pedir abrir. Agregar `http://localhost:3001` solo para pruebas. |
| `relay.type` | `simulate` (no hace nada), `serial` (relé COM) o `command` (programa externo). |
| `relay.comPort`, `relay.baudRate` | Puerto y velocidad del relé serie (LCUS-1: 9600). |
| `relay.openHex`, `relay.closeHex` | Bytes para cerrar y soltar el relé. Los del LCUS-1 canal 1 ya vienen puestos. |
| `relay.openCommand`, `relay.closeCommand` | Para `command`: líneas que se ejecutan con `cmd /c`. |

Registro: `%LOCALAPPDATA%\PiqueMolinete\molinete.log` (cada apertura y cada pedido rechazado).

## Lector de huellas (opcional)

Lectores USB de ZKTeco (ZK4500, ZK9500, SLK20R, Live20R…) con el **ZKFinger SDK** de ZKTeco.

1. Instalar en la PC del kiosco el driver del lector y el ZKFinger SDK (deja `libzkfp.dll` en System32).
2. En `config.json`:

   ```json
   "fingerprint": { "type": "zkfinger", "dll": "libzkfp.dll", "minScore": 0, "cooldownMs": 1500 }
   ```

3. Reiniciar el agente (`instalar.ps1`). En el kiosco arriba tiene que decir **Molinete · Huella**.
4. Registrar socios: ruedita → **Registrar huella** → DNI → elegir dedo → el socio acepta → apoya el
   mismo dedo 3 veces. Hasta 2 dedos por socio; desde ahí se borran también.

Cómo funciona: Pique guarda solo la plantilla (un patrón numérico, no la imagen del dedo) y la fecha
del consentimiento. El kiosco le pasa las plantillas del club al agente al abrir y cada 5 minutos; el
agente compara en la PC y le dice al kiosco de quién es la huella, y el kiosco valida el ingreso igual
que con DNI (queda en "Ingresos de hoy" como *Huella*).

Para probar sin lector: `"type": "simulate"` y mandar `POST /fingerprint/simulate` con
`{ "template": "<base64>" }` (cualquier texto en base64 hace de dedo).

Las huellas que hoy tiene AccesoGym no se pueden pasar: hay que registrar a cada socio de nuevo
(se puede hacer de a poco: mientras tanto entra con DNI o QR).

## API

- `GET /health` → `{ ok, agent, version, relay, lastOpenAt, lastError }`
- `POST /open` → cierra el relé, contesta `{ ok: true }` y lo suelta después de `pulseMs`.
- `POST /fingerprint/templates` `{ fingerprints: [{ id, format, template }] }` → reemplaza las huellas conocidas.
- `GET /fingerprint/events?after=N` → lecturas nuevas: `match` (con `fingerprintId`) o `unknown`.
- `POST /fingerprint/enroll` / `GET /fingerprint/enroll` / `DELETE /fingerprint/enroll` → registro con 3 lecturas.
- Responde CORS y `Access-Control-Allow-Private-Network` a los orígenes permitidos; al resto, 403.
