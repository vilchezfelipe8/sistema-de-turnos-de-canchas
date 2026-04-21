import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { setLogContext, clearLogContext } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export const requestContextMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  req.requestId = requestId;

  setLogContext({
    requestId,
    path: req.path,
    method: req.method,
  });

  _res.on('finish', () => {
    const clubId = (req as any).clubId;
    const userId = (req as any).user?.userId;
    if (clubId != null) setLogContext({ clubId: Number(clubId) });
    if (userId != null) setLogContext({ userId: Number(userId) });
    clearLogContext();
  });

  next();
};
