import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { normalizeApiError, toApiErrorPayload } from '../utils/apiError';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    const normalized = normalizeApiError(err);
    logger.error({
        path: req.path,
        method: req.method,
        code: normalized.code,
        field: normalized.field,
        blocking: normalized.blocking,
        message: normalized.message,
        meta: normalized.meta,
        stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack
    });
    res
        .status(normalized.statusCode)
        .json(toApiErrorPayload(normalized, String(req.requestId || '').trim() || undefined));
};
