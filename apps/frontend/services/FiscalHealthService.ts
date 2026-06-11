import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const base = (slug: string) => `${getApiUrl()}/api/clubs/${slug}/admin`;

export type HealthCheckStatus = 'ok' | 'degraded' | 'error' | 'unknown';

export type HealthCheck = {
  status: HealthCheckStatus;
  detail?: string;
  daysUntilExpiry?: number;
};

export type FiscalHealthResult = {
  overall: HealthCheckStatus;
  checks: {
    config?: HealthCheck;
    certificate?: HealthCheck;
    wsaa?: HealthCheck;
  };
  environment: 'homologacion' | 'produccion' | null;
  facturacionHabilitada?: boolean;
  checkedAt: string;
};

export const getFiscalHealth = async (slug: string): Promise<FiscalHealthResult> => {
  const res = await fetchWithAuth(`${base(slug)}/fiscal-bandeja/health`);
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al verificar el estado de ARCA');
  return res.json();
};

export const invalidateWsaaAuth = async (slug: string): Promise<void> => {
  const res = await fetchWithAuth(`${base(slug)}/fiscal-config/invalidate-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al invalidar la autenticación WSAA');
};
