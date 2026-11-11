import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const base = (slug: string) => `${getApiUrl()}/api/clubs/${slug}/admin/fiscal-bandeja`;

export type FacturaStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPROVED'
  | 'APPROVED_WITH_OBSERVATIONS'
  | 'REJECTED'
  | 'TECHNICAL_ERROR'
  | 'CANCELLED';

export type FacturaSummary = {
  id: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  status: FacturaStatus;
  originType: string;
  originId: string;
  voucherClass: string | null;
  comprobanteTipo: number | null;
  comprobanteDescripcion: string | null;
  puntoDeVenta: number | null;
  numeroComprobante: number | null;
  fechaEmision: string;
  receptorNombre: string | null;
  receptorDocNumero: string | null;
  importeTotal: string;
  cae: string | null;
  caeVencimiento: string | null;
  mensajeError: string | null;
  suggestedAction: string | null;
  intentoActual: number;
  ultimoIntentoAt: string | null;
  createdAt: string;
  pdfUrl: string | null;
  qrUrl: string | null;
};

export type FiscalIncident = {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  priority: string | null;
  status: 'OPEN' | 'RESOLVED';
  facturaId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

export const listFacturas = async (
  slug: string,
  params: { status?: string; accountId?: string; facturaId?: string; page?: number } = {}
): Promise<PaginatedResult<FacturaSummary>> => {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.accountId) qs.set('accountId', params.accountId);
  if (params.facturaId) qs.set('facturaId', params.facturaId);
  if (params.page) qs.set('page', String(params.page));
  const res = await fetchWithAuth(`${base(slug)}/facturas?${qs}`);
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al cargar comprobantes');
  return res.json();
};

export const getAccountFacturas = async (
  slug: string,
  accountId: string
): Promise<FacturaSummary[]> => {
  const result = await listFacturas(slug, { accountId });
  return result.items;
};

export type EmitFacturaInput = {
  receptorCondicionFiscal?: 'CONSUMIDOR_FINAL' | 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO';
  receptorNombre?: string;
  receptorCuit?: string;
  receptorDni?: string;
  // §55.7 — requeridos para concepto 2 (servicios) y 3 (mixto)
  fechaServicioDesde?: string; // YYYY-MM-DD
  fechaServicioHasta?: string; // YYYY-MM-DD
  fechaVencimientoPago?: string; // YYYY-MM-DD
};

export const emitAccountFactura = async (
  slug: string,
  accountId: string,
  input: EmitFacturaInput = {}
): Promise<FacturaSummary> => {
  const res = await fetchWithAuth(
    `${getApiUrl()}/api/clubs/${slug}/admin/accounts/${accountId}/emit-factura`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  );
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al emitir el comprobante');
  const data = await res.json();
  return data.factura;
};

export const retryFactura = async (slug: string, facturaId: string): Promise<void> => {
  const res = await fetchWithAuth(`${base(slug)}/facturas/${facturaId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al reintentar el comprobante');
};

export const listIncidents = async (
  slug: string,
  params: { status?: 'OPEN' | 'RESOLVED' | 'ALL'; page?: number } = {}
): Promise<PaginatedResult<FiscalIncident>> => {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.page) qs.set('page', String(params.page));
  const res = await fetchWithAuth(`${base(slug)}/incidents?${qs}`);
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al cargar incidencias');
  return res.json();
};

export const resolveIncident = async (slug: string, incidentId: string): Promise<void> => {
  const res = await fetchWithAuth(`${base(slug)}/incidents/${incidentId}/resolve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al resolver la incidencia');
};

export const createCreditNote = async (
  slug: string,
  facturaId: string
): Promise<FacturaSummary> => {
  const res = await fetchWithAuth(`${base(slug)}/facturas/${facturaId}/credit-note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) await throwApiErrorFromResponse(res, 'Error al emitir la nota de crédito');
  const data = await res.json();
  return data.factura;
};
