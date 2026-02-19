# Despliegue en VPS (Docker + Nginx)

Este documento contiene pasos recomendados para desplegar la aplicación en una VPS usando Docker y `docker-compose`.

Requisitos en la VPS (Debian/Ubuntu):

Instala las librerías necesarias para Chromium / Puppeteer (requeridas por `wpp-service`):

```bash
sudo apt update && sudo apt install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  libu2f-udev \
  libvulkan1 \
  chromium
```

NOTA: la distribución de paquetes puede variar; ajusta el nombre del paquete de Chromium si no existe (`chromium-browser` en algunas distros).

Pasos de despliegue (desde el repo clonado en la VPS):

```bash
# colocarse en la rama de deploy
git checkout feature/deploy

# construir y levantar
docker-compose build
docker-compose up -d

# ver logs
docker-compose logs -f wpp-service
docker-compose logs -f backend
```

QR de WhatsApp
- En el primer arranque, `wpp-service` emitirá un QR en los logs; escanéalo y la sesión se guardará en el volumen `wpp-session`.
- Posteriormente no será necesario volver a escanear.

Variables de entorno
- Poner credenciales en un `.env` y referenciarlas en `docker-compose.yml` (recomendado) para `DATABASE_URL`, JWT secrets, etc.

Optimización y notas
- `wpp-service` usa `puppeteer-core` y el Chrome del sistema; por eso es crítico instalar las librerías del sistema antes.
- `--disable-dev-shm-usage` está habilitado en la configuración de Puppeteer para evitar problemas de memoria compartida en contenedores.
- Si prefieres que el contenedor incluya Chromium en la imagen (más pesado), se puede revertir a `puppeteer` en lugar de `puppeteer-core`.

Rollback y mantenimiento
- Para actualizar, reconstruir y reiniciar:
  ```bash
  docker-compose pull
  docker-compose build --no-cache
  docker-compose up -d
  ```
