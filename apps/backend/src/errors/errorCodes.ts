/**
 * errorCodes — catálogo canónico de códigos de error del backend.
 *
 * Reglas:
 * - Los codes son strings constantes (no enums) para serializar limpio en JSON.
 * - El frontend puede depender de estos valores para lógica condicional.
 * - No eliminar ni renombrar codes existentes sin deprecar primero.
 * - Agregar nuevos codes en la sección correspondiente.
 */
export const ErrorCodes = {
  // ── Auth / permisos ──────────────────────────────────────────────────
  AUTH_MISSING:                 'AUTH_MISSING',
  AUTH_INVALID:                 'AUTH_INVALID',
  AUTH_EXPIRED:                 'AUTH_EXPIRED',
  AUTH_REVOKED:                 'AUTH_REVOKED',
  FORBIDDEN:                    'FORBIDDEN',
  CLUB_MEMBERSHIP_REQUIRED:     'CLUB_MEMBERSHIP_REQUIRED',
  CLUB_NOT_FOUND:               'CLUB_NOT_FOUND',

  // ── Reservas ─────────────────────────────────────────────────────────
  BOOKING_NOT_FOUND:            'BOOKING_NOT_FOUND',
  BOOKING_OVERLAP:              'BOOKING_OVERLAP',
  BOOKING_INVALID_STATUS:       'BOOKING_INVALID_STATUS',
  BOOKING_SLOT_UNAVAILABLE:     'BOOKING_SLOT_UNAVAILABLE',
  SLOT_ALREADY_BOOKED:          'SLOT_ALREADY_BOOKED',
  BOOKING_IN_PAST:              'BOOKING_IN_PAST',
  SLOT_NOT_ALLOWED:             'SLOT_NOT_ALLOWED',
  CLUB_CLOSED:                  'CLUB_CLOSED',
  DURATION_NOT_ALLOWED:         'DURATION_NOT_ALLOWED',
  ADVANCE_LIMIT_EXCEEDED:       'ADVANCE_LIMIT_EXCEEDED',
  INVALID_DATE_TIME:            'INVALID_DATE_TIME',
  MISSING_DATE_TIME:            'MISSING_DATE_TIME',
  INVALID_CLIENT_PHONE:         'INVALID_CLIENT_PHONE',
  COURT_NOT_FOUND:              'COURT_NOT_FOUND',
  ACTIVITY_NOT_FOUND:           'ACTIVITY_NOT_FOUND',
  ACTIVITY_OUT_OF_CLUB:         'ACTIVITY_OUT_OF_CLUB',
  CLUB_CONFIG_INVALID:          'CLUB_CONFIG_INVALID',
  CLUB_INVALID:                 'CLUB_INVALID',
  CLIENT_POSSIBLE_DUPLICATE:    'CLIENT_POSSIBLE_DUPLICATE',
  CLIENT_NOT_FOUND:             'CLIENT_NOT_FOUND',
  CLIENT_OUT_OF_CLUB:           'CLIENT_OUT_OF_CLUB',
  CLIENT_MERGE_CONFLICT:        'CLIENT_MERGE_CONFLICT',
  CLIENT_MERGE_SAME_CLIENT:     'CLIENT_MERGE_SAME_CLIENT',
  CLIENT_LINK_CONFLICT:         'CLIENT_LINK_CONFLICT',
  USER_NOT_FOUND:               'USER_NOT_FOUND',
  USER_CLIENT_LINK_EXISTS:      'USER_CLIENT_LINK_EXISTS',
  BOOKING_TITULAR_CHANGE_BLOCKED: 'BOOKING_TITULAR_CHANGE_BLOCKED',
  BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN: 'BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN',
  BILLING_MISSING_RESPONSIBLE: 'BILLING_MISSING_RESPONSIBLE',
  BILLING_INVALID_ASSIGNMENTS: 'BILLING_INVALID_ASSIGNMENTS',
  BILLING_ASSIGNMENTS_REQUIRED: 'BILLING_ASSIGNMENTS_REQUIRED',

  // ── Cuentas / pagos / caja ───────────────────────────────────────────
  ACCOUNT_NOT_FOUND:            'ACCOUNT_NOT_FOUND',
  ACCOUNT_CLOSED:               'ACCOUNT_CLOSED',
  ACCOUNT_HAS_PENDING_BALANCE:  'ACCOUNT_HAS_PENDING_BALANCE',
  ACCOUNT_HAS_PAYMENTS:         'ACCOUNT_HAS_PAYMENTS',
  ACCOUNT_HAS_REFUNDS:          'ACCOUNT_HAS_REFUNDS',
  PAYMENT_OVERPAY:              'PAYMENT_OVERPAY',
  PAYMENT_INVALID_AMOUNT:       'PAYMENT_INVALID_AMOUNT',
  PAYMENT_METHOD_INVALID:       'PAYMENT_METHOD_INVALID',
  NO_ACTIVE_CASH_SHIFT:         'NO_ACTIVE_CASH_SHIFT',
  CASH_SHIFT_ALREADY_OPEN:      'CASH_SHIFT_ALREADY_OPEN',
  CASH_SHIFT_NOT_FOUND:         'CASH_SHIFT_NOT_FOUND',
  CASH_SHIFT_CLOSE_BLOCKED:     'CASH_SHIFT_CLOSE_BLOCKED',
  CASH_REGISTER_NOT_FOUND:      'CASH_REGISTER_NOT_FOUND',
  REFUND_INVALID_STATUS:        'REFUND_INVALID_STATUS',
  REFUND_NOT_FOUND:             'REFUND_NOT_FOUND',

  // ── Productos / POS ──────────────────────────────────────────────────
  PRODUCT_NOT_FOUND:            'PRODUCT_NOT_FOUND',
  PRODUCT_INACTIVE:             'PRODUCT_INACTIVE',
  STOCK_INSUFFICIENT:           'STOCK_INSUFFICIENT',
  POS_ACCOUNT_CREATION_FAILED:  'POS_ACCOUNT_CREATION_FAILED',
  SERVICE_NOT_FOUND:            'SERVICE_NOT_FOUND',
  SERVICE_INACTIVE:             'SERVICE_INACTIVE',
  PRICE_RULE_NOT_FOUND:         'PRICE_RULE_NOT_FOUND',

  // ── Validación ───────────────────────────────────────────────────────
  VALIDATION_ERROR:             'VALIDATION_ERROR',
  INVALID_INPUT:                'INVALID_INPUT',

  // ── General ──────────────────────────────────────────────────────────
  NOT_FOUND:                    'NOT_FOUND',
  CONFLICT:                     'CONFLICT',
  UNEXPECTED_ERROR:             'UNEXPECTED_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
