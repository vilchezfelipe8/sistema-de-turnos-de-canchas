// xml2js with explicitArray:false returns single items as objects, not arrays.
const normalizeArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

// Converts ARCA YYYYMMDD string to ISO date string (YYYY-MM-DD)
const parseAfipDate = (value: string | undefined | null): string | undefined => {
  const s = String(value || '').trim();
  if (s.length !== 8) return undefined;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

export type ArcaObservation = {
  code: string;
  message: string;
};

export type ArcaError = {
  code: string;
  message: string;
  type: 'TECHNICAL' | 'FUNCTIONAL';
};

// §43 — respuesta interpretada al dominio
export type FiscalAuthorizationResult = {
  status: 'APPROVED' | 'APPROVED_WITH_OBSERVATIONS' | 'REJECTED' | 'TECHNICAL_ERROR';
  arcaResult?: string;
  cae?: string;
  caeDueDate?: string; // YYYY-MM-DD
  voucherNumber?: number;
  observations?: ArcaObservation[];
  errors?: ArcaError[];
};

export const parseArcaResponse = (rawResult: unknown): FiscalAuthorizationResult => {
  if (!rawResult || typeof rawResult !== 'object') {
    return {
      status: 'TECHNICAL_ERROR',
      errors: [{ code: 'EMPTY_RESPONSE', message: 'Respuesta ARCA vacia o invalida', type: 'TECHNICAL' }]
    };
  }

  const resp = rawResult as any;

  // FECAESolicitar response has FeCabResp (header) + FeDetResp.FECAEDetResponse (detail)
  const det = resp?.FeDetResp?.FECAEDetResponse;
  const headerResult = String(resp?.FeCabResp?.Resultado || '').trim();
  const detResult = String(det?.Resultado || '').trim();
  const result = detResult || headerResult;

  const cae = det?.CAE ? String(det.CAE).trim() : undefined;
  const caeVto = det?.CAEFchVto ? String(det.CAEFchVto).trim() : undefined;
  const cbteDesde = det?.CbteDesde ? Number(det.CbteDesde) : undefined;
  const voucherNumber = cbteDesde && Number.isFinite(cbteDesde) ? cbteDesde : undefined;

  // Normalize observations (xml2js may return object or array)
  const rawObs = normalizeArray(det?.Observaciones?.Obs);
  const observations: ArcaObservation[] = rawObs
    .filter((o: any) => o?.Code)
    .map((o: any) => ({
      code: String(o.Code),
      message: String(o.Msg || '')
    }));

  // Normalize errors
  const rawErrs = normalizeArray(resp?.Errors?.Err);
  const errors: ArcaError[] = rawErrs
    .filter((e: any) => e?.Code)
    .map((e: any) => ({
      code: String(e.Code),
      message: String(e.Msg || ''),
      type: 'FUNCTIONAL' as const
    }));

  // Determine status
  let status: FiscalAuthorizationResult['status'];

  if (result === 'A' && cae) {
    status = observations.length > 0 ? 'APPROVED_WITH_OBSERVATIONS' : 'APPROVED';
  } else if (result === 'R' || errors.length > 0) {
    status = 'REJECTED';
  } else {
    status = 'TECHNICAL_ERROR';
    errors.push({
      code: 'UNEXPECTED_RESPONSE',
      message: `Resultado inesperado de ARCA: "${result}"`,
      type: 'TECHNICAL'
    });
  }

  return {
    status,
    arcaResult: result || undefined,
    cae,
    caeDueDate: parseAfipDate(caeVto),
    voucherNumber,
    observations: observations.length > 0 ? observations : undefined,
    errors: errors.length > 0 ? errors : undefined
  };
};
