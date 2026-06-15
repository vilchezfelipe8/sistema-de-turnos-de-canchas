import type { ApiErrorLike, ApiErrorField } from './apiError';

export type BookingErrorBehavior = {
  field: ApiErrorField;
  blocking: boolean;
  channel: 'inline' | 'banner';
  disableSave: boolean;
  fallbackMessage: string;
};

export const BOOKING_ERROR_BEHAVIOR_BY_CODE: Record<string, BookingErrorBehavior> = {
  BOOKING_OVERLAP: {
    field: 'time',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'El horario se superpone con otra reserva.'
  },
  BOOKING_SLOT_UNAVAILABLE: {
    field: 'time',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'Ese horario no está disponible para esta cancha.'
  },
  SLOT_ALREADY_BOOKED: {
    field: 'time',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'No se pudo confirmar la disponibilidad del horario. Reintentá.'
  },
  BOOKING_IN_PAST: {
    field: 'time',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'No se pueden crear ni mover reservas al pasado.'
  },
  SLOT_NOT_ALLOWED: {
    field: 'time',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'Ese horario no está permitido por la configuración del club.'
  },
  CLUB_CLOSED: {
    field: 'date',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'El club esta cerrado en la fecha seleccionada.'
  },
  DURATION_NOT_ALLOWED: {
    field: 'duration',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'La duracion seleccionada no esta permitida.'
  },
  ADVANCE_LIMIT_EXCEEDED: {
    field: 'date',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'La fecha excede el limite de anticipacion permitido.'
  },
  BOOKING_NOT_FOUND: {
    field: 'general',
    blocking: true,
    channel: 'banner',
    disableSave: true,
    fallbackMessage: 'No se encontró la reserva.'
  },
  BOOKING_INVALID_STATUS: {
    field: 'general',
    blocking: true,
    channel: 'banner',
    disableSave: true,
    fallbackMessage: 'La reserva no está en un estado válido para esta acción.'
  },
  COURT_NOT_FOUND: {
    field: 'court',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'Seleccioná una cancha válida.'
  },
  ACTIVITY_NOT_FOUND: {
    field: 'court',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'Seleccioná una actividad válida.'
  },
  CLIENT_OUT_OF_CLUB: {
    field: 'owner',
    blocking: true,
    channel: 'banner',
    disableSave: true,
    fallbackMessage: 'El cliente seleccionado no pertenece a este club.'
  },
  BOOKING_TITULAR_CHANGE_BLOCKED: {
    field: 'owner',
    blocking: true,
    channel: 'banner',
    disableSave: true,
    fallbackMessage: 'No se puede cambiar el titular porque la reserva ya tiene pagos o movimientos registrados.'
  },
  BOOKING_PENDING_MANUAL_PAYMENT_FORBIDDEN: {
    field: 'payment',
    blocking: true,
    channel: 'banner',
    disableSave: true,
    fallbackMessage: 'Primero confirmá la reserva para poder registrar pagos.'
  },
  CLIENT_POSSIBLE_DUPLICATE: {
    field: 'owner',
    blocking: true,
    channel: 'banner',
    disableSave: true,
    fallbackMessage: 'Hay mas de un cliente posible. Revisa y selecciona el correcto.'
  },
  BILLING_MISSING_RESPONSIBLE: {
    field: 'payment',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'Falta seleccionar el responsable del cobro.'
  },
  BILLING_INVALID_ASSIGNMENTS: {
    field: 'payment',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'La asignación de cobro es inválida para el modo de pago.'
  },
  BILLING_ASSIGNMENTS_REQUIRED: {
    field: 'participants',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'Debe existir al menos un participante asignado al cobro.'
  },
  VALIDATION_ERROR: {
    field: 'general',
    blocking: true,
    channel: 'inline',
    disableSave: true,
    fallbackMessage: 'Hay campos inválidos. Revisá los datos del formulario.'
  }
};

export const resolveBookingErrorBehavior = (
  error: Pick<ApiErrorLike, 'code' | 'field' | 'blocking' | 'message'>
): BookingErrorBehavior => {
  const normalizedCode = String(error?.code || '').trim();
  const mapped = normalizedCode ? BOOKING_ERROR_BEHAVIOR_BY_CODE[normalizedCode] : undefined;
  if (mapped) return mapped;
  return {
    field: (error?.field || 'general') as ApiErrorField,
    blocking: typeof error?.blocking === 'boolean' ? error.blocking : true,
    channel: 'inline',
    disableSave: typeof error?.blocking === 'boolean' ? error.blocking : true,
    fallbackMessage: String(error?.message || 'No se pudo guardar. Intenta nuevamente.')
  };
};
