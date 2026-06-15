import { AppError } from './AppError';
import { ErrorCodes } from './errorCodes';

const UNEXPECTED_FALLBACK = 'No pudimos completar la acción. Intentá nuevamente.';

/** Interfaz mínima de Response — permite testear sin mock del tipo completo de Express. */
interface MinResponse {
  status(code: number): this;
  json(body: unknown): this;
}

/**
 * sendAppError — handler canónico para catch blocks de controllers.
 *
 * Comportamiento:
 *  - Si `error` es AppError → responde con el statusCode, code y mensaje del error.
 *  - Si `error` es cualquier otra cosa (bug interno, Prisma, TypeError…) →
 *    logea el detalle completo, responde 500 + UNEXPECTED_ERROR + fallback genérico.
 *
 * Esto garantiza que errores técnicos NUNCA llegan al cliente como mensaje crudo.
 *
 * Ejemplo en controller:
 *   } catch (error) {
 *     return sendAppError(res, error, 'No se pudo cerrar la cuenta');
 *   }
 */
export const sendAppError = (
  res: MinResponse,
  error: unknown,
  fallback: string = UNEXPECTED_FALLBACK,
): MinResponse => {
  if (error instanceof AppError) {
    const body: Record<string, unknown> = {
      error: error.message,
      code: error.code,
    };
    if (error.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
      body.fieldErrors = error.fieldErrors;
    }
    if (error.meta !== undefined) {
      body.meta = error.meta;
    }
    return res.status(error.statusCode).json(body);
  }

  // Error inesperado — log completo internamente, respuesta genérica al exterior
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error ?? '(empty)');
  console.error('[UNEXPECTED_ERROR]', fallback, detail);

  return res.status(500).json({
    error: fallback,
    code: ErrorCodes.UNEXPECTED_ERROR,
  });
};
