# 🚂 Guía de Despliegue en Railway

Esta guía te ayudará a desplegar el backend del sistema de turnos en Railway.

## 📋 Requisitos Previos

1. Cuenta en [Railway](https://railway.app)
2. Repositorio del proyecto en GitHub (recomendado) o GitLab
3. Node.js 18+ instalado localmente (para desarrollo)

## 🚀 Pasos para Desplegar

### 1. Crear un Proyecto en Railway

1. Ve a [railway.app](https://railway.app) e inicia sesión
2. Haz clic en **"New Project"**
3. Selecciona **"Deploy from GitHub repo"** (o la opción que prefieras)
4. Conecta tu repositorio y selecciona la rama `railway-deploy`

### 2. Configurar la Base de Datos PostgreSQL

1. En el dashboard de Railway, haz clic en **"+ New"**
2. Selecciona **"Database"** → **"Add PostgreSQL"**
3. Railway creará automáticamente una base de datos PostgreSQL
4. La variable `DATABASE_URL` se configurará automáticamente

### 3. Configurar el Servicio del Backend

1. En el dashboard, haz clic en **"+ New"** → **"GitHub Repo"**
2. Selecciona el repositorio y la rama `railway-deploy`
3. Railway detectará automáticamente que es un proyecto Node.js
4. **Importante**: Configura el **Root Directory** como `apps/backend`

### 4. Configurar Variables de Entorno

En la pestaña **"Variables"** del servicio, agrega las siguientes variables:

#### Variables Requeridas:

```env
# JWT Secret (genera uno seguro, por ejemplo con: openssl rand -base64 32)
JWT_SECRET=tu_secreto_jwt_muy_seguro_aqui

# Database URL (se configura automáticamente si conectaste la DB)
# DATABASE_URL ya está configurada automáticamente por Railway

# Puerto (Railway lo asigna automáticamente, pero puedes especificarlo)
PORT=3000

# Entorno
NODE_ENV=production

# URL del frontend (ajusta según tu dominio)
FRONTEND_URL=https://tu-frontend.railway.app
```

#### Variables Opcionales:

```env
# Intervalo para completar turnos vencidos (en milisegundos)
BOOKINGS_COMPLETION_INTERVAL_MS=60000
```

### 5. Configurar el Root Directory

**MUY IMPORTANTE**: Como el backend está en `apps/backend`, necesitas configurar el root directory:

1. Ve a la configuración del servicio (Settings)
2. En **"Root Directory"**, ingresa: `apps/backend`
3. Guarda los cambios

### 6. Configurar el Build y Start

Railway detectará automáticamente los scripts del `package.json`:
- **Build**: `npm run build` (ejecuta `prisma generate` y `tsc`)
- **Start**: `npm run start` (ejecuta `node dist/index.js`)

El script `postbuild` se ejecutará automáticamente después del build para aplicar las migraciones de Prisma.

### 7. Primera Migración de Base de Datos

Si es la primera vez que despliegas, tienes dos opciones:

#### Opción A: Usar Prisma Migrate (Recomendado)

1. Localmente, ejecuta:
   ```bash
   cd apps/backend
   npx prisma migrate dev --name init
   ```
2. Esto creará la carpeta `prisma/migrations/`
3. Haz commit y push de las migraciones a la rama `railway-deploy`
4. Railway ejecutará automáticamente `prisma migrate deploy` en el postbuild

#### Opción B: Usar Prisma DB Push (Rápido para pruebas)

Si no tienes migraciones, el script `postbuild` intentará usar `prisma db push` como fallback. Esto sincronizará el schema directamente con la base de datos.

### 8. Verificar el Despliegue

1. Una vez desplegado, Railway te dará una URL (ej: `https://tu-backend.railway.app`)
2. Verifica el healthcheck: `https://tu-backend.railway.app/health`
3. Deberías ver: `{"status":"ok"}`

### 9. (Opcional) Ejecutar Seed

Si necesitas datos iniciales, puedes ejecutar el seed manualmente:

1. En Railway, ve a la pestaña **"Deployments"**
2. Haz clic en el deployment más reciente
3. Abre la terminal
4. Ejecuta: `npm run prisma:seed`

O desde tu máquina local (conectándote a la DB de Railway):

```bash
cd apps/backend
DATABASE_URL="tu_database_url_de_railway" npm run prisma:seed
```

## 🔧 Solución de Problemas

### Error: "Missing DATABASE_URL"
- Verifica que hayas creado y conectado la base de datos PostgreSQL
- Railway debería configurar `DATABASE_URL` automáticamente

### Error: "Missing JWT_SECRET"
- Asegúrate de haber agregado la variable `JWT_SECRET` en las Variables de Entorno

### Error en Prisma Migrate
- Si no tienes migraciones, el script usará `prisma db push` como fallback
- Para producción, es mejor crear migraciones: `npx prisma migrate dev --name init`

### Error: "Cannot find module"
- Verifica que el Root Directory esté configurado como `apps/backend`
- Asegúrate de que el build se complete correctamente

### El servidor no inicia
- Revisa los logs en Railway (pestaña "Deployments" → "View Logs")
- Verifica que el puerto esté configurado correctamente (Railway asigna el PORT automáticamente)

## 📝 Notas Adicionales

- Railway asigna automáticamente un puerto, usa `process.env.PORT` (ya está configurado en `index.ts`)
- El healthcheck está configurado en `/health` para que Railway pueda verificar el estado
- Las migraciones se ejecutan automáticamente después de cada build
- Railway ofrece un plan gratuito generoso para empezar

## 🔗 Recursos

- [Documentación de Railway](https://docs.railway.app)
- [Railway Discord](https://discord.gg/railway)
- [Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment)
