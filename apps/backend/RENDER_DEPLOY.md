# 🚀 Guía de Despliegue en Render

Esta guía te ayudará a desplegar el backend en Render.

## 📋 Requisitos Previos

1. Una cuenta en [Render](https://render.com)
2. El código subido a un repositorio Git (GitHub, GitLab, etc.)

## 🔧 Paso 1: Preparar el Repositorio

Asegúrate de que tu código esté en un repositorio Git y que los siguientes archivos estén incluidos:
- `apps/backend/package.json`
- `apps/backend/src/`
- `apps/backend/prisma/`
- `apps/backend/tsconfig.json`

## 🗄️ Paso 2: Crear Base de Datos PostgreSQL en Render

1. Ve a tu [Dashboard de Render](https://dashboard.render.com)
2. Haz clic en **"New +"** → **"PostgreSQL"**
3. Configura:
   - **Name**: `sistema-turnos-db` (o el nombre que prefieras)
   - **Database**: `sistema_turnos`
   - **User**: `sistema_turnos_user`
   - **Region**: Elige la más cercana (Oregon recomendado)
   - **Plan**: Free (para empezar)
4. Haz clic en **"Create Database"**
5. **IMPORTANTE**: Copia la **Internal Database URL** (la necesitarás después)

## 🌐 Paso 3: Crear Web Service (Backend)

1. En tu Dashboard, haz clic en **"New +"** → **"Web Service"**
2. Conecta tu repositorio Git
3. Configura el servicio:

### Configuración Básica:
- **Name**: `sistema-turnos-backend`
- **Environment**: `Node`
- **Region**: La misma que tu base de datos
- **Branch**: `main` (o tu rama principal)
- **Root Directory**: `apps/backend`

### Build Command:
```bash
npm install && npm run build
```

### Start Command:
```bash
npm start
```

### Environment Variables (Variables de Entorno):
Agrega las siguientes variables:

| Key | Value | Notas |
|-----|-------|-------|
| `NODE_ENV` | `production` | |
| `PORT` | `10000` | Render asigna automáticamente, pero esto funciona |
| `DATABASE_URL` | `[Internal Database URL]` | La URL que copiaste de tu PostgreSQL |
| `JWT_SECRET` | `[Tu secreto seguro]` | Usa un string largo y aleatorio (puedes generar uno con: `openssl rand -base64 32`) |
| `FRONTEND_URL` | `[URL de tu frontend]` | Ej: `https://tu-frontend.onrender.com` o `http://localhost:3001` para desarrollo |

**Ejemplo de JWT_SECRET:**
```bash
# En tu terminal local, ejecuta:
openssl rand -base64 32
```

**Ejemplo de DATABASE_URL:**
```
postgresql://sistema_turnos_user:password@dpg-xxxxx-a/sistema_turnos
```

### Health Check Path:
```
/health
```

4. Haz clic en **"Create Web Service"**

## ⚙️ Paso 4: Configurar Auto-Deploy

Render automáticamente:
1. Ejecutará `npm install`
2. Ejecutará `npm run build` (que incluye `prisma generate` y compilación TypeScript)
3. Ejecutará `npm run postbuild` (que ejecuta `prisma migrate deploy`)
4. Iniciará el servidor con `npm start`

## ✅ Paso 5: Verificar el Despliegue

1. Espera a que termine el build (puede tomar 5-10 minutos la primera vez)
2. Verifica los logs en la pestaña **"Logs"**
3. Prueba el endpoint de health:
   ```
   https://tu-backend.onrender.com/health
   ```
   Debería responder: `{"status":"ok"}`

## 🔗 Paso 6: Conectar Frontend

Una vez que el backend esté funcionando:

1. Obtén la URL de tu backend (algo como: `https://sistema-turnos-backend.onrender.com`)
2. Actualiza la variable de entorno `NEXT_PUBLIC_API_URL` en tu frontend:
   ```env
   NEXT_PUBLIC_API_URL=https://sistema-turnos-backend.onrender.com
   ```
3. Actualiza `FRONTEND_URL` en el backend con la URL de tu frontend

## 🐛 Troubleshooting

### Error: "Missing DATABASE_URL"
- Verifica que la variable de entorno `DATABASE_URL` esté configurada correctamente
- Asegúrate de usar la **Internal Database URL** (no la externa)

### Error: "Missing JWT_SECRET"
- Verifica que la variable `JWT_SECRET` esté configurada
- Debe ser un string largo y seguro

### Error: "Prisma migrate deploy failed"
- Verifica que el `DATABASE_URL` sea correcto
- Revisa los logs para ver el error específico de Prisma

### Error: "Port already in use"
- Render asigna automáticamente el puerto a través de `process.env.PORT`
- No necesitas especificar un puerto manualmente

### El servidor no inicia
- Revisa los logs en Render
- Verifica que `dist/index.js` exista después del build
- Asegúrate de que todas las dependencias estén en `dependencies` (no solo en `devDependencies`)

## 📝 Notas Importantes

1. **Free Tier**: Render puede "sleep" los servicios gratuitos después de 15 minutos de inactividad. Para producción, considera un plan pago.

2. **Build Time**: Los builds pueden tardar varios minutos. Ten paciencia.

3. **Database Migrations**: Las migraciones se ejecutan automáticamente después del build gracias al script `postbuild`.

4. **CORS**: El backend ahora acepta requests desde la URL especificada en `FRONTEND_URL`.

5. **Logs**: Siempre revisa los logs en Render si algo no funciona.

## 🔄 Actualizaciones Futuras

Cada vez que hagas push a tu rama principal, Render automáticamente:
1. Detectará los cambios
2. Ejecutará un nuevo build
3. Desplegará la nueva versión

¡Listo! Tu backend debería estar funcionando en Render. 🎉

