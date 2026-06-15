import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/errorCodes';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    // AppError — error de dominio tipado, respuesta directa sin normalizar
    if (err instanceof AppError) {
        logger.error({
            path: req.path,
            method: req.method,
            code: err.code,
            message: err.message,
            meta: err.meta,
            stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
        });
        const body: Record<string, unknown> = { error: err.message, code: err.code };
        if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) body.fieldErrors = err.fieldErrors;
        if (err.meta !== undefined) body.meta = err.meta;
        return res.status(err.statusCode).json(body);
    }

    logger.error({
        path: req.path,
        method: req.method,
        code: ErrorCodes.UNEXPECTED_ERROR,
        message: err instanceof Error ? err.message : String(err ?? ''),
        stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack
    });

    return res.status(500).json({
        error: 'No pudimos completar la acción. Intentá nuevamente.',
        code: ErrorCodes.UNEXPECTED_ERROR,
    });
};
