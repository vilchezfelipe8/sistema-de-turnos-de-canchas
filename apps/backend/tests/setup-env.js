// Entorno fijo para los tests: corre antes que cualquier test (node --test -r ./tests/setup-env.js).
//
// Prisma carga apps/backend/.env por su cuenta pero NO pisa variables ya definidas. Definirlas acá
// hace que los tests den lo mismo en una máquina con .env de desarrollo y en CI (sin .env).
// Los tests que necesitan otro valor lo cambian con su propio withEnv.

const testEnv = {
  NODE_ENV: 'test',

  // Base inalcanzable a propósito: los tests no deben tocar una base real (usan mocks).
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/pique_test',
  DIRECT_DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/pique_test',
  READ_DATABASE_URL: '',
  REDIS_URL: '',

  // Secretos de prueba (no son de ningún entorno real).
  JWT_SECRET: 'test-jwt-secret-solo-para-tests',
  AUTH_REFRESH_PEPPER: 'test-refresh-pepper-solo-para-tests',
  VERIFICATION_CODE_PEPPER: 'test-verification-pepper-solo-para-tests',
  INTEGRATION_SECRETS_KEY: 'test-integration-secrets-key-32-bytes-min!!',

  FRONTEND_URL: 'http://localhost:3001',
  APP_BASE_URL: 'http://localhost:3000',

  // Feature flags en sus valores por defecto del código (ver src/config/featureFlags.ts).
  ENABLE_OUTBOX: 'true',
  ENABLE_WHATSAPP_WORKER: 'true',
  ENABLE_WHATSAPP_SEND_V2: 'false',
  ENABLE_WHATSAPP_CUSTOMER_EVENTS_V2: 'false',
  ENABLE_WHATSAPP_STAFF_EVENTS_V2: 'false',
  ENABLE_WHATSAPP_V2_DRY_RUN: 'false',
  ENABLE_WHATSAPP_CLOUD_API: 'false',
  ENABLE_WHATSAPP_WEBHOOK_PROCESSOR: 'false',
  ENABLE_READ_MODELS: 'true',
  ENABLE_ARCA_WORKER: 'false',
  MERCADO_PAGO_ENABLED: 'false',
  DISABLE_WHATSAPP: 'true',

  // Integraciones externas vacías: ningún test puede tomar tokens reales ni la allowlist del .env.
  WHATSAPP_META_RECIPIENT_ALLOWLIST: '',
  WHATSAPP_META_ACCESS_TOKEN: '',
  WHATSAPP_META_WEBHOOK_VERIFY_TOKEN: '',
  WHATSAPP_META_WABA_ID: '',
  WHATSAPP_META_PHONE_NUMBER_ID: '',
  WHATSAPP_META_BUSINESS_PHONE: '',
  MERCADO_PAGO_CLIENT_ID: '',
  MERCADO_PAGO_CLIENT_SECRET: '',
  MERCADO_PAGO_WEBHOOK_SECRET: '',
  MERCADO_PAGO_TEST_TOKEN: '',
  GOOGLE_OAUTH_CLIENT_ID: '',
  GOOGLE_OAUTH_CLIENT_SECRET: '',
  FACEBOOK_OAUTH_CLIENT_ID: '',
  FACEBOOK_OAUTH_CLIENT_SECRET: '',
};

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}
