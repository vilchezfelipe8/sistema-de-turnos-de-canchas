#!/bin/bash

# Script simple que funciona en Git Bash de Windows
# Uso: ./setup-db-simple.sh

echo "🗑️  Eliminando contenedor anterior..."
docker rm -f sistema-postgres 2>&1

echo "🐘 Iniciando contenedor de PostgreSQL..."
docker run -d --name sistema-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=1234 \
  -e POSTGRES_DB=sistema_turnos \
  -p 5432:5432 \
  postgres:15

echo "⏳ Esperando 5 segundos..."
sleep 5

echo "📦 Sincronizando esquema..."
npx prisma db push --accept-data-loss

echo "🔧 Generando Prisma Client..."
npx prisma generate

echo "🌱 Ejecutando seed..."
npx prisma db seed

echo "✅ ¡Base de datos configurada correctamente!"
