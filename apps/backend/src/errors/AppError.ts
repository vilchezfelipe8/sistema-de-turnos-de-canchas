/**
 * AppError — error de dominio tipado.
 *
 * Lanzalo desde los services cuando la falla es esperada y tiene semántica
 * de negocio (cuenta cerrada, stock insuficiente, caja sin turno abierto…).
 *
 * NO lances AppError para bugs internos, errores de Prisma, TypeErrors, etc.
 * Esos deben propagarse como errores ordinarios y el controller los captura
 * con `sendAppError`, que los convierte en 500 + UNEXPECTED_ERROR.
 *
 * Ejemplo:
 *   throw new AppError({ code: 'ACCOUNT_CLOSED', statusCode: 409, message: 'Esta cuenta ya está cerrada.' });
 *   throw new AppError({ code: 'CLIENT_POSSIBLE_DUPLICATE', statusCode: 409, message: '...', meta: { candidates } });
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly fieldErrors?: Record<string, string>;
  readonly meta?: Record<string, unknown>;
  readonly details?: Record<string, unknown>;

  constructor(params: {
    code: string;
    statusCode: number;
    message: string;
    fieldErrors?: Record<string, string>;
    meta?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.fieldErrors = params.fieldErrors;
    this.meta = params.meta;
    // Compatibilidad interna durante la migración de callers legacy.
    // La respuesta HTTP canónica sigue usando `meta`.
    this.details = params.meta;
    // Mantiene stack trace limpio en V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}
