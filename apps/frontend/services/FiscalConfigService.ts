import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const base = (slug: string) => `${getApiUrl()}/api/clubs/${slug}/admin/fiscal-config`;

export type PuntoDeVentaFiscal = {
  id: string;
  puntoDeVenta: number;
  nombre: string | null;
  activo: boolean;
};

export type FiscalConfigData = {
  id: string;
  clubId: number;
  facturacionHabilitada: boolean;
  proveedorFiscal: string;
  usaHomologacion: boolean;
  activo: boolean;
  modoFacturacion: string | null;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string | null;
  ingresosBrutos: string | null;
  inicioActividadesAt: string | null;
  hasCertificate: boolean;
  certificadoSerial: string | null;
  certificadoSubject: string | null;
  vencimientoCertificado: string | null;
  onboardingStatus: string | null;
  defaultPuntoDeVentaFiscalId: string | null;
  puntosDeVentaFiscales: PuntoDeVentaFiscal[];
};

export type FiscalConfigUpdateInput = {
  facturacionHabilitada?: boolean;
  usaHomologacion?: boolean;
  activo?: boolean;
  modoFacturacion?: 'OBLIGATORIA' | 'OPCIONAL' | 'DESHABILITADA';
  defaultPuntoDeVentaFiscalId?: string | null;
  razonSocial?: string | null;
  cuit?: string | null;
  condicionIva?: string | null;
  ingresosBrutos?: string | null;
  inicioActividadesAt?: string | null;
};

export type CertUploadInput = {
  certificadoPem: string;
  clavePrivadaPem: string;
  clavePrivadaPassphrase?: string;
};

export type CertUploadResult = {
  ok: boolean;
  certificadoSerial: string | null;
  certificadoSubject: string | null;
  vencimientoCertificado: string | null;
};

export const getFiscalConfig = async (slug: string): Promise<FiscalConfigData | null> => {
  const res = await fetchWithAuth(base(slug));
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al cargar la configuración fiscal');
  const data = await res.json();
  return data.config ?? null;
};

export const updateFiscalConfig = async (
  slug: string,
  input: FiscalConfigUpdateInput
): Promise<FiscalConfigData> => {
  const res = await fetchWithAuth(base(slug), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al guardar la configuración fiscal');
  const data = await res.json();
  return data.config;
};

export const uploadCertificate = async (
  slug: string,
  input: CertUploadInput
): Promise<CertUploadResult> => {
  const res = await fetchWithAuth(`${base(slug)}/certificate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al guardar el certificado');
  return res.json();
};

export const createPuntoDeVenta = async (
  slug: string,
  input: { puntoDeVenta: number; nombre?: string }
): Promise<PuntoDeVentaFiscal> => {
  const res = await fetchWithAuth(`${base(slug)}/puntos-de-venta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al crear el punto de venta');
  const data = await res.json();
  return data.item;
};

export const togglePuntoDeVenta = async (
  slug: string,
  pdvId: string
): Promise<PuntoDeVentaFiscal> => {
  const res = await fetchWithAuth(`${base(slug)}/puntos-de-venta/${pdvId}/toggle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al actualizar el punto de venta');
  const data = await res.json();
  return data.item;
};
