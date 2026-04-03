import { Response } from 'express';

export type AuthErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'AUTH_REVOKED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_CONTEXT_INVALID';

export const sendAuthError = (
  res: Response,
  status: 400 | 401 | 403,
  code: AuthErrorCode,
  error: string
) => {
  const requestId = String((res as any)?.req?.requestId || '').trim();
  return res.status(status).json({
    error,
    message: error,
    code,
    blocking: true,
    field: 'general',
    retryable: status >= 500,
    ...(requestId ? { requestId } : {})
  });
};
