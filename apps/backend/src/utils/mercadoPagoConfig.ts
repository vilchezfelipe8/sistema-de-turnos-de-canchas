const isProduction = process.env.NODE_ENV === 'production';

const normalizeUrl = (value: string | undefined) => String(value || '').trim().replace(/\/+$/, '');
const normalizeBool = (value: string | undefined, fallback = false) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

export const mercadoPagoConfig = {
  enabled: normalizeBool(process.env.MERCADO_PAGO_ENABLED, false),
  clientId: String(process.env.MERCADO_PAGO_CLIENT_ID || '').trim(),
  clientSecret: String(process.env.MERCADO_PAGO_CLIENT_SECRET || '').trim(),
  redirectUri: String(process.env.MERCADO_PAGO_REDIRECT_URI || '').trim(),
  webhookSecret: String(process.env.MERCADO_PAGO_WEBHOOK_SECRET || '').trim(),
  authUrl: normalizeUrl(process.env.MERCADO_PAGO_AUTH_URL || 'https://auth.mercadopago.com/authorization'),
  apiBaseUrl: normalizeUrl(process.env.MERCADO_PAGO_API_BASE_URL || 'https://api.mercadopago.com'),
  useTestToken: normalizeBool(process.env.MERCADO_PAGO_TEST_TOKEN, false),
  frontendUrl: normalizeUrl(process.env.FRONTEND_URL),
  appBaseUrl: normalizeUrl(process.env.APP_BASE_URL)
};

export const isMercadoPagoGloballyConfigured = () =>
  mercadoPagoConfig.enabled &&
  Boolean(
    mercadoPagoConfig.clientId &&
    mercadoPagoConfig.clientSecret &&
    mercadoPagoConfig.redirectUri &&
    mercadoPagoConfig.webhookSecret &&
    mercadoPagoConfig.frontendUrl &&
    mercadoPagoConfig.appBaseUrl
  );

if (isProduction && mercadoPagoConfig.enabled) {
  if (!isMercadoPagoGloballyConfigured()) {
    throw new Error(
      'Invalid Mercado Pago config in production: configure client id/secret, redirect URI, webhook secret, FRONTEND_URL and APP_BASE_URL.'
    );
  }
}
