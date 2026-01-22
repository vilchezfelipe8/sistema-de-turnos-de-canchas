#!/bin/bash
# Script para configurar la base de datos en Railway
# Uso: DATABASE_URL="tu_url_de_railway" ./scripts/setup-railway-db.sh

echo "🔧 Configurando base de datos en Railway..."

# 1. Generar Prisma Client
echo "📦 Generando Prisma Client..."
npx prisma generate

# 2. Aplicar schema (crea las tablas)
echo "🗄️ Aplicando schema a la base de datos..."
npx prisma db push --accept-data-loss

# 3. Ejecutar seed (cargar datos iniciales)
echo "🌱 Ejecutando seed..."
npm run prisma:seed

echo "✅ Base de datos configurada exitosamente!"
