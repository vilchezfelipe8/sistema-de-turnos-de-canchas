// Tipo local — reemplazar con tipo de dominio en PR3
export type ArcaEnvironment = 'TEST' | 'PRODUCTION';

const env = (key: string) => String(process.env[key] || '').trim();
const envBool = (key: string, fallback = false) => {
  const raw = env(key).toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
};
const envNumber = (key: string, fallback: number) => {
  const raw = Number(env(key));
  return Number.isFinite(raw) ? raw : fallback;
};

const WSAA_TEST_URL = 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';
const WSAA_PROD_URL = 'https://wsaa.afip.gov.ar/ws/services/LoginCms';
const WSFE_TEST_URL = 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';
const WSFE_PROD_URL = 'https://wsfev1.afip.gov.ar/wsfev1/service.asmx';

export const arcaConfig = {
  enabled: envBool('ARCA_ENABLED', false),
  wsaaService: env('ARCA_WSAA_SERVICE') || 'wsfe',
  timeoutMs: envNumber('ARCA_TIMEOUT_MS', 20000),
  getWsaaUrl: (environment: ArcaEnvironment) => {
    if (environment === 'PRODUCTION') {
      return env('ARCA_WSAA_URL_PROD') || WSAA_PROD_URL;
    }
    return env('ARCA_WSAA_URL_TEST') || WSAA_TEST_URL;
  },
  getWsfeUrl: (environment: ArcaEnvironment) => {
    if (environment === 'PRODUCTION') {
      return env('ARCA_WSFE_URL_PROD') || WSFE_PROD_URL;
    }
    return env('ARCA_WSFE_URL_TEST') || WSFE_TEST_URL;
  }
};
