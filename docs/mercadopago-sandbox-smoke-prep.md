# Mercado Pago Sandbox Smoke Prep

Guía operativa para preparar el entorno antes de ejecutar el smoke real de `I.3C`.

## 1. Variables de entorno requeridas

| Env | Dónde se configura | Valor esperado | Obligatorio para |
| --- | --- | --- | --- |
| `APP_BASE_URL` | backend runtime / deploy env | URL pública HTTPS del backend, sin `/api` | callback OAuth, webhook URL, links backend |
| `FRONTEND_URL` | frontend y backend env | URL pública HTTPS del frontend | CORS, redirects públicos, return URLs |
| `ALLOWED_ORIGINS` | backend env | lista explícita de orígenes frontend, separada por comas | CORS con credenciales |
| `MERCADO_PAGO_CLIENT_ID` | backend secret env | client id sandbox de la app OAuth de Mercado Pago | OAuth y creación de preferencias |
| `MERCADO_PAGO_CLIENT_SECRET` | backend secret env | client secret sandbox | OAuth y llamadas server-to-server |
| `MERCADO_PAGO_REDIRECT_URI` | backend env + app MP dashboard | `${APP_BASE_URL}/api/integrations/mercadopago/callback` | callback OAuth |
| `MERCADO_PAGO_WEBHOOK_SECRET` | backend secret env + app MP dashboard | secret compartido de webhook sandbox | validar firma del webhook |
| `INTEGRATION_SECRETS_KEY` | backend secret env | secreto fuerte de 32+ bytes para cifrado | cifrado de access/refresh tokens de clubes |
| `JWT_SECRET` | backend secret env | secreto fuerte y único | auth |
| `AUTH_REFRESH_PEPPER` | backend secret env | secreto fuerte y único | refresh tokens |

Notas:

- No usar `localhost` para `APP_BASE_URL` en el smoke real.
- `MERCADO_PAGO_REDIRECT_URI` debe coincidir exactamente con la registrada en Mercado Pago.
- `APP_BASE_URL` debe apuntar al backend, no al frontend.

## 2. URL pública recomendada

| Opción | OAuth callback | Webhook | Riesgo / comentario |
| --- | --- | --- | --- |
| Staging backend público HTTPS | Sí | Sí | recomendada; más parecida a piloto |
| Túnel HTTPS al backend local (`ngrok`, `cloudflared`) | Sí | Sí | rápida para smoke; cuidado con URL efímera |
| Frontend público sin backend público | No | No | no sirve |
| Solo localhost | No | No | no sirve para callback/webhook reales |

Recomendación:

1. Si ya existe staging con backend público HTTPS, usar esa opción.
2. Si no existe staging listo, usar un túnel HTTPS al backend local como camino más rápido.

## 3. Configuración en Mercado Pago

Checklist de dashboard sandbox:

1. Crear o abrir la app sandbox de Mercado Pago.
2. Obtener `client_id` y `client_secret` sandbox.
3. Registrar como redirect URI:
   - `${APP_BASE_URL}/api/integrations/mercadopago/callback`
4. Configurar webhook apuntando a:
   - `${APP_BASE_URL}/api/webhooks/mercadopago`
5. Guardar el secret/firma del webhook en `MERCADO_PAGO_WEBHOOK_SECRET`.
6. Confirmar permisos OAuth necesarios:
   - acceso para obtener tokens,
   - crear preferencias,
   - consultar pagos.
7. Preparar usuarios sandbox:
   - un vendedor sandbox para el club,
   - un comprador sandbox para el jugador.

## 4. Base de datos y migraciones

Diagnóstico actual:

- La base local existente no está baselined para `prisma migrate deploy`.
- `prisma migrate status` devuelve `P3005` cuando intenta tratar una base ya poblada como si fuera una base nueva de migraciones.

Plan recomendado:

| Tema | Acción recomendada |
| --- | --- |
| Local actual | seguir con `prisma db push` para smoke local si la base ya existía antes del historial de migraciones |
| Nueva DB staging limpia | usar `prisma migrate deploy` desde cero |
| Producción | no tocar ahora; definir baseline con cuidado antes de usar `migrate deploy` |
| Si querés alinear local con migraciones reales | crear una DB local nueva y aplicar `prisma migrate deploy` sobre esa DB nueva |

Recomendación práctica:

- Para `I.3C` usar una DB staging nueva o una DB local nueva y limpia.
- No usar la DB local vieja como criterio para validar `migrate deploy`.

## 5. Checklist manual de smoke

### OAuth

1. Entrar como `OWNER` o `ADMIN`.
2. Ir a `Admin > Ajustes > Integraciones`.
3. Ver Mercado Pago en estado desconectado.
4. Click en `Conectar Mercado Pago`.
5. Autorizar la cuenta sandbox de vendedor.
6. Ver callback exitoso en la app.
7. Confirmar estado `CONNECTED`.
8. Confirmar que:
   - no se exponen tokens en frontend,
   - `connectedById` quedó seteado,
   - el state no se reutiliza.

### Checkout

1. Crear o elegir una reserva futura pagable.
2. Confirmar:
   - titular explícito,
   - `Account BOOKING` abierta,
   - saldo pendiente mayor a 0,
   - sin refunds.
3. Entrar como jugador titular.
4. Ir a `Mis reservas`.
5. Abrir `Estado de pago`.
6. Ver botón `Pagar online con Mercado Pago`.
7. Click en pagar.
8. Confirmar:
   - se crea `OnlinePaymentAttempt`,
   - hay redirect al `init_point`,
   - aún no existe `Payment`,
   - no existe `CashMovement` POS.

### Webhook

1. Completar pago sandbox con comprador sandbox.
2. Confirmar recepción del webhook.
3. Confirmar que backend consulta el provider.
4. Confirmar que:
   - se crea `Payment` con `source=ONLINE`,
   - se crean allocations correctas,
   - baja el `pending` de la cuenta,
   - no se crea `CashMovement` POS.
5. Reenviar o duplicar webhook.
6. Confirmar que no duplica `Payment` ni allocations.

## 6. Qué no tocar en esta fase

- lógica de negocio de reservas,
- pagos por participante,
- refunds online automáticos,
- Open Match,
- marketplace/comunidad,
- caja admin/POS,
- cálculo de montos en frontend.

## 7. Criterio para considerar pagos online listos para piloto

Los pagos online quedan listos para piloto solo cuando:

1. OAuth sandbox funciona end-to-end.
2. Checkout sandbox crea intento y redirige correctamente.
3. El return URL no confirma nada por sí solo.
4. El webhook real aprobado crea exactamente un `Payment`.
5. No se crea `CashMovement` POS.
6. El saldo de `Account BOOKING` queda consistente.
7. El webhook duplicado no duplica cobros.

## 8. I.3C — Smoke Mercado Pago sandbox

Estado: **parcial / no cerrado**.

### Validado

- OAuth seller sandbox por club.
- Integración Mercado Pago persistida por club.
- Preference/initPoint real creado.
- `OnlinePaymentAttempt` creado.
- No se crea `Payment` antes del webhook.
- No se crea `CashMovement` POS.
- Return URL no confirma pago.
- Webhook sigue siendo la única fuente de confirmación.

### Bloqueado

- No se pudo completar pago sandbox aprobado.
- El botón `Pagar` queda deshabilitado en el checkout sandbox.
- No llegó webhook aprobado real.
- No se validó `Payment ONLINE` real por webhook.
- No se validó idempotencia real con webhook duplicado.

### Diagnóstico probable

Restricción o comportamiento del sandbox de Mercado Pago:

- buyer sandbox no apto,
- sesión de seller usada como buyer,
- wallet/test buyer con restricción,
- configuración sandbox rara.

No hay evidencia suficiente para tocar arquitectura.

### Acciones futuras recomendadas

1. Crear buyer sandbox nuevo.
2. Probar en incógnito / navegador limpio.
3. Verificar seller != buyer.
4. Probar otra app sandbox si persiste.
5. Consultar documentación o soporte de Mercado Pago si el botón sigue deshabilitado.
6. Repetir smoke hasta validar:
   - pago aprobado,
   - webhook real,
   - `Payment ONLINE` único,
   - no `CashMovement POS`,
   - idempotencia.

### Criterio para cerrar I.3C

I.3C solo se cierra cuando:

- un pago sandbox se completa,
- Mercado Pago envía webhook real aprobado,
- backend crea un único `Payment` con `source=ONLINE`,
- `Account BOOKING` baja `pending` correctamente,
- no se crea `CashMovement POS`,
- webhook duplicado no duplica `Payment` ni allocations.

## 9. I.3C real — Smoke Mercado Pago con pago real controlado

Estado: **cerrado**.

### Validado

- Pago real aprobado.
- Webhook real recibido.
- `OnlinePaymentAttempt` pasó a `APPROVED`.
- Se creó un único `Payment` con `source=ONLINE`.
- Se creó una única `PaymentAllocation`.
- `Account BOOKING` quedó con `paid = total` y `pending = 0`.
- No se creó `CashMovement POS`.
- No se requirió caja abierta.
- Return URL no confirmó el pago.
- Replay de webhook devolvió `alreadyProcessed: true`.
- Idempotencia validada.

### Datos no sensibles del smoke

- `bookingId`: `189`
- `attemptId`: `cmp93etif018811toohsmhah0`
- provider payment id: `158897986909`
- amount: `466.67`
- provider status: `approved`
- payment source: `ONLINE`

### Conclusión

La implementación de Mercado Pago queda validada end-to-end para un pago real controlado.

Queda fuera de este cierre:

- pagos por participante,
- refunds online automáticos,
- Open Match,
- marketplace/comunidad,
- conciliación avanzada,
- panel admin de intentos online,
- chargebacks/disputas,
- suscripción SaaS del club,
- profesores/liquidaciones,
- proveedores/cuentas por pagar.
