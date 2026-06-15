import { AppError } from './AppError';
import { ErrorCodes } from './errorCodes';

/**
 * Factories — helpers para crear AppError sin repetir boilerplate.
 *
 * Usalos desde services cuando el error es de negocio esperado:
 *
 *   throw notFound('Cuenta no encontrada', ErrorCodes.ACCOUNT_NOT_FOUND);
 *   throw conflict('Esta cuenta ya está cerrada.', ErrorCodes.ACCOUNT_CLOSED);
 *   throw badRequest('Stock insuficiente.', ErrorCodes.STOCK_INSUFFICIENT, { requested: 5, available: 2 });
 */

export const badRequest = (
  message: string,
  code: string = ErrorCodes.INVALID_INPUT,
  meta?: Record<string, unknown>,
): AppError =>
  new AppError({ code, statusCode: 400, message, meta });

export const notFound = (
  message: string,
  code: string = ErrorCodes.NOT_FOUND,
  meta?: Record<string, unknown>,
): AppError =>
  new AppError({ code, statusCode: 404, message, meta });

export const conflict = (
  message: string,
  code: string = ErrorCodes.CONFLICT,
  meta?: Record<string, unknown>,
): AppError =>
  new AppError({ code, statusCode: 409, message, meta });

export const unprocessable = (
  message: string,
  code: string,
  meta?: Record<string, unknown>,
): AppError =>
  new AppError({ code, statusCode: 422, message, meta });

export const forbidden = (
  message: string,
  code: string = ErrorCodes.FORBIDDEN,
): AppError =>
  new AppError({ code, statusCode: 403, message });

export const validationError = (
  message: string,
  fieldErrors: Record<string, string>,
): AppError =>
  new AppError({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400, message, fieldErrors });
