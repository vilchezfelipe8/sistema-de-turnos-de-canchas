# Release Checklist

Checklist corto antes de un deploy o de invitar a un club piloto.

1. `git status --short` limpio.
2. Backend: `npx prisma validate`.
3. Backend: `npx prisma generate`.
4. Backend: `npx tsc --noEmit`.
5. Backend: `npm test`.
6. Backend: `npm run build`.
7. Frontend: `npx tsc --noEmit`.
8. Frontend: `npm run build`.
9. Confirmar DB objetivo nueva o consistente.
10. Confirmar backup antes de migrar.
11. Correr `npx prisma migrate deploy`.
12. Confirmar envs reales completas.
13. Verificar login admin.
14. Verificar agenda / reserva / cliente.
15. Verificar POS / caja si entra.
16. Verificar login jugador / Mis reservas.
17. Si MP está activo, hacer smoke chico controlado.
18. Verificar rollback conocido antes de abrir acceso.
