# Deploy

Resumen operativo de despliegue para Pique.

## Fuente principal

La guía detallada sigue en:

- `README-DEPLOY.md`

## Regla general

- staging persistente: diferido por ahora;
- staging por túnel: solo validación interna;
- clubes reales: solo sobre entorno productivo controlado;
- nunca usar `db push` en staging ni producción.

## Flujo recomendado

1. crear DB nueva y limpia;
2. validar `CREATE EXTENSION btree_gist`;
3. correr `npx prisma migrate deploy`;
4. correr `npx prisma generate`;
5. cargar seed mínimo o bootstrap controlado;
6. configurar backend y frontend con envs reales;
7. correr smoke interno;
8. recién después invitar al club.

## Dominio recomendado para el primer piloto

Default recomendado:

- frontend: `https://pique.ar`
- backend: `https://pique.ar/api`

Alternativas futuras:

- `https://app.pique.ar`
- `https://api.pique.ar`

Motivo del default inicial:

- una sola VPS;
- reverse proxy simple;
- mismo origen;
- menos problemas de CORS y cookies;
- menor complejidad operativa.

## Documentos relacionados

- `docs/env-matrix.md`
- `docs/release-checklist.md`
- `docs/pilot-readiness.md`
