@echo off
REM Script para configurar la base de datos desde cero (Windows)
REM Uso: setup-db.bat

echo 🗑️  Eliminando contenedor anterior (si existe)...
docker rm -f sistema-postgres 2>nul

echo 🐘 Iniciando contenedor de PostgreSQL...
docker run -d --name sistema-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=1234 -e POSTGRES_DB=sistema_turnos -p 5432:5432 postgres:15

echo ⏳ Esperando a que PostgreSQL esté listo...
timeout /t 3 /nobreak >nul

echo 📦 Sincronizando esquema de Prisma con la base de datos...
call npx prisma db push --accept-data-loss

echo 🔧 Generando Prisma Client...
call npx prisma generate

echo 🌱 Ejecutando seed...
call npx prisma db seed

echo ✅ ¡Base de datos configurada correctamente!
pause
