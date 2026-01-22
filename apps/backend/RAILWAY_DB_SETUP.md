# 🗄️ Configurar Base de Datos en Railway

Esta guía te ayudará a configurar la estructura de la base de datos y cargar los datos iniciales en Railway.

## 📋 Opción 1: Usando la Terminal de Railway (Recomendado)

### Paso 1: Obtener la DATABASE_URL

1. En Railway, ve a tu proyecto
2. Haz clic en la base de datos PostgreSQL que creaste
3. Ve a la pestaña **"Variables"**
4. Copia el valor de `DATABASE_URL` (algo como: `postgresql://postgres:password@host:5432/railway`)

### Paso 2: Abrir Terminal en Railway

1. Ve a tu servicio del backend en Railway
2. Haz clic en la pestaña **"Deployments"**
3. Haz clic en el deployment más reciente
4. Haz clic en **"View Logs"** o busca la opción **"Terminal"**

### Paso 3: Ejecutar comandos en la terminal

Una vez en la terminal de Railway, ejecuta estos comandos:

```bash
# 1. Generar Prisma Client
npx prisma generate

# 2. Aplicar el schema (crea todas las tablas)
npx prisma db push

# 3. Cargar datos iniciales (seed)
npm run prisma:seed
```

## 📋 Opción 2: Desde tu máquina local

Si prefieres hacerlo desde tu computadora:

### Paso 1: Obtener DATABASE_URL de Railway

1. En Railway, ve a tu base de datos PostgreSQL
2. Copia la `DATABASE_URL` de las variables de entorno

### Paso 2: Ejecutar comandos localmente

```bash
cd apps/backend

# Configurar la DATABASE_URL temporalmente
export DATABASE_URL="tu_database_url_de_railway_aqui"

# 1. Generar Prisma Client
npx prisma generate

# 2. Aplicar el schema
npx prisma db push

# 3. Ejecutar seed
npm run prisma:seed
```

## ✅ Verificación

Después de ejecutar los comandos, deberías tener:

1. ✅ Todas las tablas creadas (User, Club, Court, ActivityType, Booking, FixedBooking)
2. ✅ Datos iniciales cargados:
   - Usuario admin: `admin@local.test` / `admin123`
   - Usuario miembro: `lio@messi.com` / `123456`
   - Actividad: Pádel
   - Club: Club Central
   - Cancha: Cancha Central

## 🔍 Verificar que funcionó

Puedes verificar en Railway:
1. Ve a tu base de datos PostgreSQL
2. Haz clic en **"Data"** o **"Query"**
3. Deberías ver las tablas creadas y datos en ellas

O desde la terminal de Railway:
```bash
npx prisma studio
```
(Esto abrirá Prisma Studio en un puerto, pero en Railway puedes usar la terminal para verificar)

## 📝 Notas

- `prisma db push` sincroniza el schema directamente sin crear archivos de migración
- El seed es idempotente (puedes ejecutarlo múltiples veces sin problemas)
- Si necesitas migraciones versionadas más adelante, puedes crear migraciones con `npx prisma migrate dev --name nombre_migracion`
