import { Response } from 'express';

export type ApiErrorField =
  | 'general'
  | 'date'
  | 'time'
  | 'court'
  | 'duration'
  | 'participants'
  | 'payment'
  | 'notes'
  | 'owner'
  | string;

export type ApiErrorCode = string;

export type ApiErrorMetadata = Record<string, unknown>;

type ApiErrorParams = {
  code: ApiErrorCode;
  message: string;
  statusCode?: number;
  blocking?: boolean;
  field?: ApiErrorField;
  meta?: ApiErrorMetadata;
  retryable?: boolean;
};

type UnknownErrorWithShape = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  blocking?: unknown;
  field?: unknown;
  meta?: unknown;
  retryable?: unknown;
  details?: unknown;
};

export type ApiErrorResponsePayload = {
  error: string;
  message: string;
  code: string;
  blocking: boolean;
  field: ApiErrorField;
  meta?: ApiErrorMetadata;
  retryable: boolean;
  requestId?: string;
};

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;
  public readonly blocking: boolean;
  public readonly field: ApiErrorField;
  public readonly meta?: ApiErrorMetadata;
  public readonly retryable: boolean;

  constructor(params: ApiErrorParams) {
    super(params.message);
    this.name = 'ApiError';
    this.code = String(params.code || 'UNEXPECTED_ERROR');
    this.statusCode = Number.isInteger(params.statusCode) ? Number(params.statusCode) : 500;
    this.blocking = typeof params.blocking === 'boolean' ? params.blocking : this.statusCode < 500;
    this.field = typeof params.field === 'string' && params.field.trim().length > 0 ? params.field : 'general';
    this.meta = params.meta;
    this.retryable = typeof params.retryable === 'boolean' ? params.retryable : this.statusCode >= 500;
  }
}

const readUnknownMessage = (value: unknown): string => {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (value instanceof Error && typeof value.message === 'string' && value.message.trim().length > 0) {
    return value.message;
  }
  return '';
};

const readUnknownObject = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const safeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return undefined;
};

export const normalizeApiError = (
  error: unknown,
  fallbackMessage = 'Error interno del servidor',
  fallbackCode = 'UNEXPECTED_ERROR'
): ApiError => {
  if (error instanceof ApiError) return error;

  const known = (error || {}) as UnknownErrorWithShape;
  const statusCodeRaw = safeNumber(known.statusCode) ?? safeNumber(known.status);
  const statusCode =
    statusCodeRaw && statusCodeRaw >= 400 && statusCodeRaw <= 599
      ? statusCodeRaw
      : 500;
  const message = readUnknownMessage(error) || fallbackMessage;
  const code =
    typeof known.code === 'string' && known.code.trim().length > 0
      ? known.code.trim()
      : fallbackCode;
  const field =
    typeof known.field === 'string' && known.field.trim().length > 0
      ? known.field.trim()
      : 'general';
  const metaFromError = readUnknownObject(known.meta);
  const details = readUnknownObject(known.details);
  const meta = metaFromError || details;
  const blocking = typeof known.blocking === 'boolean' ? known.blocking : statusCode < 500;
  const retryable = typeof known.retryable === 'boolean' ? known.retryable : statusCode >= 500;

  return new ApiError({
    code,
    message,
    statusCode,
    blocking,
    field,
    meta,
    retryable
  });
};

export const toApiErrorPayload = (
  error: ApiError,
  requestId?: string
): ApiErrorResponsePayload => ({
  error: error.message,
  message: error.message,
  code: error.code,
  blocking: error.blocking,
  field: error.field,
  ...(error.meta ? { meta: error.meta } : {}),
  retryable: error.retryable,
  ...(requestId ? { requestId } : {})
});

const resolveResponseRequestId = (res: Response): string | undefined => {
  const request = (res as any)?.req;
  const requestId = String(request?.requestId || request?.id || '').trim();
  return requestId.length > 0 ? requestId : undefined;
};

export const sendApiError = (
  res: Response,
  input: ApiError | ApiErrorParams
) => {
  const normalized = input instanceof ApiError ? input : new ApiError(input);
  return res
    .status(normalized.statusCode)
    .json(toApiErrorPayload(normalized, resolveResponseRequestId(res)));
};
