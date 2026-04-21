import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error({
        path: req.path,
        method: req.method,
        message: err?.message || String(err),
        stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack
    });
    const status = err?.statusCode || 500;
    res.status(status).json({ error: err?.message || 'Error interno del servidor' });
};
