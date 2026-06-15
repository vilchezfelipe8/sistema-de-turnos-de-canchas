# Setup Local

Guía corta para levantar Pique en una máquina nueva sin adivinar pasos.

## 1. Prerrequisitos

- Node 20+
- npm 10+
- Docker
- Docker Compose o Docker con soporte de `docker compose`

## 2. Variables de entorno

1. Copiar `env.example` a `.env`.
2. Ajustar solo si necesitás cambiar puertos o servicios locales.

Para desarrollo local puro, alcanza con:

- `NODE_ENV=development`
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `JWT_SECRET`
- `AUTH_REFRESH_PEPPER`

## 3. Base de datos local

Recomendado:

```bash
cd apps/backend
npm install
npm run db:setup
```

Eso:

1. levanta o reutiliza PostgreSQL local;
2. crea la DB si falta;
3. valida `btree_gist`;
4. corre `prisma migrate deploy` desde Linux;
5. genera Prisma Client.

Si además querés datos demo:

```bash
cd apps/backend
RUN_SEED=true npm run db:setup
```

## 4. Backend

```bash
cd apps/backend
npm install
npm run dev
```

Queda en:

- `http://localhost:3000`

## 5. Frontend

```bash
cd apps/frontend
npm install
npm run dev
```

Queda en:

- `http://localhost:3001`

## 6. Validación mínima

Backend:

```bash
cd apps/backend
npx prisma validate
npx prisma generate
npx tsc --noEmit
```

Frontend:

```bash
cd apps/frontend
npx tsc --noEmit
```

## 7. Notas

- No usar `db push` como estrategia de staging/producción.
- `db:setup:win` no está soportado por ahora; usar WSL o bash.
- WhatsApp puede quedar apagado localmente sin bloquear el resto del sistema.
