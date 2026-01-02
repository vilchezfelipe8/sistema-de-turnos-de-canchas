import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string; // Proviene de las variables de entorno (validado en startup)

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // 1. Buscamos el token en la cabecera "Authorization"
    const authHeader = req.headers['authorization'];
    // El formato suele ser "Bearer eyJhbGciOi..." (separamos la palabra Bearer)
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        // Si no hay token, no entra nadie.
        return res.status(401).json({ error: "Acceso denegado. Falta el token." });
    }

    // 2. Verificamos si la firma del token es real
    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) {
            return res.status(403).json({ error: "Token inválido o expirado." });
        }

        // 3. Si todo está bien, guardamos los datos del usuario en la petición
        // para que el Controller sepa quién es.
        (req as any).user = user; 

        next(); // ¡Pase usted!
    });
};