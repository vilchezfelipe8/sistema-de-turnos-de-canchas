# Checklist: preparar rama `feature/despliegue` (NO desplegar)

Pasos para preparar la rama de despliegue (local):

1. Crear la rama localmente:

```bash
git checkout -b feature/despliegue
```

2. Añadir los archivos preparados y los cambios ya realizados:

```bash
git add env.example VERCEL_CHECKLIST.md src/index.ts src/controllers/AuthController.ts src/middleware/AuthMiddleware.ts
git commit -m "chore: mover JWT secret a env y agregar env.example + checklist"
```

3. Subir la rama al remoto:

```bash
git push -u origin feature/despliegue
```

4. Verificaciones locales antes de push:
- Asegurarse de no tener credenciales en `.env` en el commit.
- Añadir `.env` a `.gitignore` si no existe.
- Confirmar que `JWT_SECRET` está definido en el `.env` local para pruebas.

5. Notas específicas:
- Este branch está preparado para despliegue en Vercel en el futuro, pero NO ejecutar deploy todavía.
- Revisar y aplicar las recomendaciones de seguridad antes de desplegar (migraciones, transacciones en reservas, validaciones).

