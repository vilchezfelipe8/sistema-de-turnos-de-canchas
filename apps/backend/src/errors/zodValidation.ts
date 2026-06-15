import { ZodError } from 'zod';
import { validationError } from './factories';

const normalizeFieldPath = (path: Array<string | number>): string => {
  if (!Array.isArray(path) || path.length === 0) return 'general';
  return path
    .map((part) => (typeof part === 'number' ? String(part) : String(part).trim()))
    .filter(Boolean)
    .join('.');
};

export const flattenZodFieldErrors = (
  error: ZodError,
  pathMap?: Record<string, string>
): Record<string, string> => {
  const mapped: Record<string, string> = {};

  for (const issue of error.issues) {
    const rawField = normalizeFieldPath(issue.path);
    const field = pathMap?.[rawField] || pathMap?.[String(issue.path?.[0] || '')] || rawField || 'general';
    if (!mapped[field]) {
      mapped[field] = String(issue.message || 'Dato inválido').trim() || 'Dato inválido';
    }
  }

  if (Object.keys(mapped).length === 0) {
    mapped.general = 'Revisá los campos marcados.';
  }

  return mapped;
};

export const zodValidationAppError = (
  error: ZodError,
  message = 'Revisá los campos marcados.',
  pathMap?: Record<string, string>
) => validationError(message, flattenZodFieldErrors(error, pathMap));
