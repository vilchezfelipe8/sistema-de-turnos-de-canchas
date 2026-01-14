import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    console.log('Auth header recibido:', authHeader);
    const token = authHeader && authHeader.split(' ')[1];
    console.log('Token extraído:', token ? 'Presente' : 'Ausente');

    if (!token) {
        return res.status(401).json({ error: "Acceso denegado. Falta el token." });
    }

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) {
            console.log('Error al verificar token:', err);
            return res.status(403).json({ error: "Token inválido o expirado." });
        }

        console.log('Usuario del token:', user);
        (req as any).user = user;
        next();
    });
};

// Middleware opcional: si viene token lo verifica y setea req.user, si no viene token sigue sin error.
export const optionalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];    if (!token) {
        (req as any).user = null;
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) {
            console.log('Error al verificar token en optionalAuth:', err);
            // No bloqueamos, dejamos user null para que el controlador decida
            (req as any).user = null;
            return next();
        }
        (req as any).user = user;
        next();
    });
};