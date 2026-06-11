import type { FiscalAuthorizationResult } from './arcaResponseParser';

// §44 — acciones operativas ante errores fiscales
export type FiscalErrorAction =
  | 'RETRY_AUTOMATICALLY'
  | 'REFRESH_AUTH_AND_RETRY'
  | 'REQUIRE_ADMIN_CONFIGURATION_FIX'
  | 'REQUIRE_RECEIVER_DATA_FIX'
  | 'REQUIRE_ENGINEERING_REVIEW'
  | 'REQUIRE_MANUAL_RECONCILIATION'
  | 'STORE_NOTICE_ONLY';

// §44 — catálogo de códigos de error ARCA conocidos → acción sugerida
const KNOWN_ERROR_ACTIONS: Record<string, FiscalErrorAction> = {
  // Auth errors — token/sign/CUIT inválido
  '10002': 'REFRESH_AUTH_AND_RETRY',
  '10003': 'REFRESH_AUTH_AND_RETRY',
  '10004': 'REFRESH_AUTH_AND_RETRY',

  // Correlatividad — riesgo de duplicado o secuencia incorrecta
  '600':   'REQUIRE_MANUAL_RECONCILIATION',
  '601':   'REQUIRE_MANUAL_RECONCILIATION',
  '602':   'REQUIRE_MANUAL_RECONCILIATION',

  // Punto de venta o tipo de comprobante no habilitado
  '10016': 'REQUIRE_ADMIN_CONFIGURATION_FIX',
  '10040': 'REQUIRE_ADMIN_CONFIGURATION_FIX',
  '10041': 'REQUIRE_ADMIN_CONFIGURATION_FIX',

  // Certificado inválido o no autorizado para el servicio
  '10265': 'REQUIRE_ADMIN_CONFIGURATION_FIX',
  '10266': 'REQUIRE_ADMIN_CONFIGURATION_FIX',

  // Datos del receptor incorrectos
  '10043': 'REQUIRE_RECEIVER_DATA_FIX',
  '10044': 'REQUIRE_RECEIVER_DATA_FIX',
  '10046': 'REQUIRE_RECEIVER_DATA_FIX',
  '10048': 'REQUIRE_RECEIVER_DATA_FIX',

  // Importes o IVA inconsistentes — revisar motor fiscal
  '10070': 'REQUIRE_ENGINEERING_REVIEW',
  '10071': 'REQUIRE_ENGINEERING_REVIEW',
  '10072': 'REQUIRE_ENGINEERING_REVIEW',
  '10145': 'REQUIRE_ENGINEERING_REVIEW',
  '10146': 'REQUIRE_ENGINEERING_REVIEW',
  '10148': 'REQUIRE_ENGINEERING_REVIEW',

  // Respuestas técnicas internas del parser
  'EMPTY_RESPONSE':    'RETRY_AUTOMATICALLY',
  'UNEXPECTED_RESPONSE': 'RETRY_AUTOMATICALLY',
  'EXCEPTION':         'RETRY_AUTOMATICALLY'
};

export const getSuggestedAction = (result: FiscalAuthorizationResult): FiscalErrorAction => {
  if (result.status === 'APPROVED' || result.status === 'APPROVED_WITH_OBSERVATIONS') {
    return 'STORE_NOTICE_ONLY';
  }

  if (!result.errors || result.errors.length === 0) {
    return result.status === 'TECHNICAL_ERROR' ? 'RETRY_AUTOMATICALLY' : 'REQUIRE_ENGINEERING_REVIEW';
  }

  // Return the action for the first recognized error code; precedence follows array order
  for (const error of result.errors) {
    const action = KNOWN_ERROR_ACTIONS[error.code];
    if (action) return action;
  }

  return result.status === 'TECHNICAL_ERROR' ? 'RETRY_AUTOMATICALLY' : 'REQUIRE_ENGINEERING_REVIEW';
};
