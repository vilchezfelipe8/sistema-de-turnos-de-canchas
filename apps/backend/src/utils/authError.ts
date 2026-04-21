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
  return res.status(status).json({ error, code });
};

