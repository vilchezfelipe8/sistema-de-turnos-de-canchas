import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Invitar a un jugador encontrado por nombre sin exponer su id, email ni DNI:
// - `ref`: identificador estable y opaco (sirve para no agregar dos veces a la misma persona).
// - `inviteToken`: firmado por el servidor y atado a quien buscó; solo ese usuario puede usarlo para invitar.

const TOKEN_PURPOSE = 'player-invite';
const TOKEN_TTL = '30d';

const secret = () => {
    const value = String(process.env.JWT_SECRET || '').trim();
    if (!value) throw new Error('JWT_SECRET is required');
    return value;
};

// Clave propia derivada de JWT_SECRET: un token de invitación nunca puede validar como token de sesión.
const inviteSecret = () => crypto.createHmac('sha256', secret()).update(`${TOKEN_PURPOSE}:v1`).digest();

export const playerRefFor = (userId: number) =>
    crypto.createHmac('sha256', secret()).update(`player-ref:${userId}`).digest('base64url').slice(0, 16);

export const signPlayerInviteToken = (input: { invitedUserId: number; requesterUserId: number }) =>
    jwt.sign({ typ: TOKEN_PURPOSE, uid: input.invitedUserId, by: input.requesterUserId }, inviteSecret(), { algorithm: 'HS256', expiresIn: TOKEN_TTL });

// Devuelve el id del usuario invitado, o null si el token no es válido, venció o es de otra persona.
export const verifyPlayerInviteToken = (token: string, requesterUserId: number): number | null => {
    try {
        const payload = jwt.verify(String(token || ''), inviteSecret(), { algorithms: ['HS256'] }) as { typ?: string; uid?: unknown; by?: unknown };
        if (payload?.typ !== TOKEN_PURPOSE) return null;
        if (Number(payload.by) !== Number(requesterUserId)) return null;
        const invitedUserId = Number(payload.uid);
        return Number.isInteger(invitedUserId) && invitedUserId > 0 ? invitedUserId : null;
    } catch {
        return null;
    }
};
