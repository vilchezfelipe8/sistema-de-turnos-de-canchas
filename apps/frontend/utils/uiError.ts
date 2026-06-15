type UiErrorContext = {
  area: string;
  action: string;
  fallbackMessage?: string;
};

const DEFAULT_FALLBACK = 'Ocurrio un error inesperado. Intenta nuevamente.';

export const extractErrorMessage = (
  error: unknown,
  fallbackMessage = DEFAULT_FALLBACK
) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message?.trim()) return error.message;

  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }

  return fallbackMessage;
};

export const reportUiError = (context: UiErrorContext, error: unknown) => {
  const message = extractErrorMessage(error, context.fallbackMessage);

  if (process.env.NODE_ENV !== 'production') {
    const details =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error && typeof error === 'object'
          ? { ...error }
          : error;
    console.error(`[${context.area}] ${context.action}: ${message}`, details);
  }

  return message;
};
