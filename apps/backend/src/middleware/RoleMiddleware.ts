import { Request, Response, NextFunction } from 'express';

export const requireRole = (role: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user;
        console.log('Usuario en requireRole:', user);
        console.log('Rol requerido:', role);
        if (!user) {
            return res.status(401).json({ error: 'Acceso denegado. Falta autenticación.' });
        }
        if (user.role !== role) {
            console.log('Rol del usuario:', user.role, 'no coincide con', role);
            return res.status(403).json({ error: 'Permisos insuficientes.' });
        }
        next();
    };
};

