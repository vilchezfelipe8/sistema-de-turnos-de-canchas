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

export type ApiErrorLike = {
  code: string | null;
  message: string;
  blocking: boolean;
  field: ApiErrorField;
  meta?: Record<string, unknown>;
  retryable: boolean;
  status?: number;
  requestId?: string;
};

type UnknownPayload = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const readObject = (value: unknown): UnknownPayload | null => {
  if (!isRecord(value)) return null;
  return value;
};

const messageFromPayload = (payload: UnknownPayload, fallback: string): string => {
  const nestedError = readObject(payload.error);
  const nestedMessage =
    readString(nestedError?.message) ||
    readString(nestedError?.error);
  const directMessage = readString(payload.message) || readString(payload.error);
  const resolved = nestedMessage || directMessage || fallback;
  return resolved.length > 0 ? resolved : fallback;
};

const codeFromPayload = (payload: UnknownPayload): string | null => {
  const nestedError = readObject(payload.error);
  const directCode = readString(payload.code);
  const nestedCode = readString(nestedError?.code);
  const code = directCode || nestedCode;
  return code.length > 0 ? code : null;
};

const fieldFromPayload = (payload: UnknownPayload): ApiErrorField => {
  const nestedError = readObject(payload.error);
  const directField = readString(payload.field);
  const nestedField = readString(nestedError?.field);
  return (directField || nestedField || 'general') as ApiErrorField;
};

const boolFromPayload = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

export class ApiRequestError extends Error implements ApiErrorLike {
  public readonly code: string | null;
  public readonly blocking: boolean;
  public readonly field: ApiErrorField;
  public readonly meta?: Record<string, unknown>;
  public readonly retryable: boolean;
  public readonly status?: number;
  public readonly requestId?: string;

  constructor(data: ApiErrorLike) {
    super(data.message);
    this.name = 'ApiRequestError';
    this.code = data.code;
    this.blocking = data.blocking;
    this.field = data.field;
    this.meta = data.meta;
    this.retryable = data.retryable;
    this.status = data.status;
    this.requestId = data.requestId;
  }
}

export const normalizeApiError = (
  error: unknown,
  fallbackMessage = 'Ocurrio un error inesperado.'
): ApiRequestError => {
  if (error instanceof ApiRequestError) return error;

  if (error instanceof Error) {
    const raw = error as Error & Partial<ApiErrorLike>;
    return new ApiRequestError({
      code: typeof raw.code === 'string' ? raw.code : null,
      message: readString(raw.message) || fallbackMessage,
      blocking: typeof raw.blocking === 'boolean' ? raw.blocking : true,
      field: typeof raw.field === 'string' ? raw.field : 'general',
      meta: isRecord(raw.meta) ? raw.meta : undefined,
      retryable: typeof raw.retryable === 'boolean' ? raw.retryable : false,
      status: typeof raw.status === 'number' ? raw.status : undefined,
      requestId: typeof raw.requestId === 'string' ? raw.requestId : undefined
    });
  }

  return new ApiRequestError({
    code: null,
    message: fallbackMessage,
    blocking: true,
    field: 'general',
    retryable: false
  });
};

export const parseApiErrorPayload = (
  payload: unknown,
  fallbackMessage: string
): ApiErrorLike => {
  if (!isRecord(payload)) {
    return {
      code: null,
      message: fallbackMessage,
      blocking: true,
      field: 'general',
      retryable: false
    };
  }

  const nestedError = readObject(payload.error);
  const blockingRaw =
    payload.blocking ?? nestedError?.blocking;
  const retryableRaw =
    payload.retryable ?? nestedError?.retryable;
  const metaRaw =
    (isRecord(payload.meta) ? payload.meta : undefined) ??
    (isRecord(nestedError?.meta) ? (nestedError?.meta as Record<string, unknown>) : undefined);
  const legacyMeta: Record<string, unknown> = {};
  if (Array.isArray(payload.overlaps)) {
    legacyMeta.overlaps = payload.overlaps;
  }
  if (typeof payload.canProceed === 'boolean') {
    legacyMeta.canProceed = payload.canProceed;
  }
  const requestIdRaw =
    readString(payload.requestId) || readString(nestedError?.requestId);
  const statusRaw = Number(payload.status);
  const resolvedMeta =
    metaRaw ??
    (Object.keys(legacyMeta).length > 0 ? legacyMeta : undefined);

  return {
    code: codeFromPayload(payload),
    message: messageFromPayload(payload, fallbackMessage),
    blocking: boolFromPayload(blockingRaw, true),
    field: fieldFromPayload(payload),
    meta: resolvedMeta,
    retryable: boolFromPayload(retryableRaw, false),
    status: Number.isFinite(statusRaw) ? statusRaw : undefined,
    requestId: requestIdRaw || undefined
  };
};

export const parseApiErrorResponse = async (
  response: Response,
  fallbackMessage: string
): Promise<ApiRequestError> => {
  try {
    const payload = await response.clone().json();
    const parsed = parseApiErrorPayload(payload, fallbackMessage);
    return new ApiRequestError({
      ...parsed,
      status: response.status
    });
  } catch {
    try {
      const text = readString(await response.clone().text());
      return new ApiRequestError({
        code: null,
        message: text || fallbackMessage,
        blocking: true,
        field: 'general',
        retryable: response.status >= 500,
        status: response.status
      });
    } catch {
      return new ApiRequestError({
        code: null,
        message: fallbackMessage,
        blocking: true,
        field: 'general',
        retryable: response.status >= 500,
        status: response.status
      });
    }
  }
};

export const throwApiErrorFromResponse = async (
  response: Response,
  fallbackMessage: string
): Promise<never> => {
  throw await parseApiErrorResponse(response, fallbackMessage);
};
