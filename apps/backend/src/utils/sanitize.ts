/**
 * Sanitiza strings de usuario para evitar XSS e inyección HTML.
 * Elimina tags HTML, entidades peligrosas y caracteres de control.
 */
const HTML_TAG_REGEX = /<[^>]*>/g;
const DANGEROUS_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const MAX_LENGTH = 2000;

export function sanitizeString(value: string | null | undefined, maxLen = MAX_LENGTH): string {
  if (value == null) return '';
  const str = String(value).trim();
  if (!str) return '';

  const stripped = str
    .replace(HTML_TAG_REGEX, '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(DANGEROUS_CHARS, '');

  if (maxLen > 0 && stripped.length > maxLen) {
    return stripped.slice(0, maxLen);
  }
  return stripped;
}

/** Para nombres cortos (cliente, producto): 200 chars */
export function sanitizeShortText(value: string | null | undefined): string {
  return sanitizeString(value, 200);
}

/** Para descripciones: 500 chars */
export function sanitizeDescription(value: string | null | undefined): string {
  return sanitizeString(value, 500);
}
