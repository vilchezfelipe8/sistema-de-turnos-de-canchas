import { Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getUserClubContext } from '../utils/getUserClubContext';
import { getPreferredClubIdFromRequest } from '../utils/clubContext';
import { normalizeIdentityPhone } from '../utils/phone';
import { logger } from '../utils/logger';
import { AuthEmailService } from '../services/AuthEmailService';
import { authConfig } from '../utils/authConfig';
import { AuthSessionService } from '../services/AuthSessionService';
import { AuthTokenService } from '../services/AuthTokenService';
import {
    generateMagicLinkToken,
    getMagicLinkExpiresAt,
    getMagicLinkTtlMinutes,
    hashMagicLinkToken,
    normalizeEmail
} from '../utils/magicLink';
import { sendAuthError } from '../utils/authError';
const MAGIC_LINK_NEUTRAL_MESSAGE = 'Si el email es válido, te enviamos un enlace para ingresar.';
const DEFAULT_MAGIC_LINK_USER_FIRST_NAME = 'Nuevo';
const DEFAULT_MAGIC_LINK_USER_LAST_NAME = 'Usuario';
const DEFAULT_MAGIC_LINK_USER_PHONE = '+0000000000';

const membershipPriority: Record<string, number> = {
    OWNER: 0,
    ADMIN: 1,
    STAFF: 2,
    CUSTOMER: 3
};

const getMembershipsForUser = async (userId: number) => {
    const memberships = await prisma.membership.findMany({
        where: { userId },
        select: {
            clubId: true,
            role: true,
            club: {
                select: {
                    id: true,
                    slug: true
                }
            }
        }
    });

    return memberships.sort((left, right) => {
        const leftPriority = membershipPriority[String(left.role)] ?? 99;
        const rightPriority = membershipPriority[String(right.role)] ?? 99;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return left.clubId - right.clubId;
    });
};

const resolveActiveMembership = async (userId: number, preferredClubId?: number) => {
    try {
        const clubContext = await getUserClubContext(userId, preferredClubId);
        const club = await prisma.club.findUnique({
            where: { id: clubContext.clubId },
            select: { id: true, slug: true }
        });

        return {
            clubId: clubContext.clubId,
            role: clubContext.role,
            club: club ?? null
        };
    } catch {
        return null;
    }
};

const getRequestIp = (req: Request): string | null => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
        return forwardedFor.split(',')[0]?.trim() || null;
    }
    if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
        return String(forwardedFor[0] || '').trim() || null;
    }
    return req.ip ? String(req.ip).trim() : null;
};

const getApiBaseUrl = (req: Request): string => {
    const configured = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = req.get('host');
    return host ? `${protocol}://${host}` : 'http://localhost:3000';
};

const getFrontendBaseUrl = (req: Request): string => {
    const frontendConfigured = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
    if (frontendConfigured) return frontendConfigured;
    return getApiBaseUrl(req);
};

type VerifyFailureReason = 'invalid_or_expired' | 'internal_error';

export class AuthController {
    private authEmailService: AuthEmailService | null = null;
    private authSessionService = new AuthSessionService();
    private authTokenService = new AuthTokenService();

    private getAuthEmailService() {
        if (!this.authEmailService) {
            this.authEmailService = new AuthEmailService();
        }
        return this.authEmailService;
    }

    private getCookieBaseOptions() {
        return {
            httpOnly: true,
            secure: authConfig.cookieSecure,
            sameSite: authConfig.cookieSameSite,
            domain: authConfig.cookieDomain,
            path: '/'
        } as const;
    }

    private setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
        const base = this.getCookieBaseOptions();
        const accessMaxAgeMs = authConfig.accessTtlMinutes * 60 * 1000;
        const refreshMaxAgeMs = authConfig.refreshIdleDays * 24 * 60 * 60 * 1000;
        res.cookie(authConfig.accessCookieName, accessToken, {
            ...base,
            maxAge: accessMaxAgeMs
        });
        res.cookie(authConfig.refreshCookieName, refreshToken, {
            ...base,
            maxAge: refreshMaxAgeMs
        });
    }

    private clearSessionCookies(res: Response) {
        const base = this.getCookieBaseOptions();
        res.clearCookie(authConfig.accessCookieName, base);
        res.clearCookie(authConfig.refreshCookieName, base);
    }

    private getRequestMeta(req: Request) {
        const userAgent = String(req.headers['user-agent'] || '').trim() || null;
        return {
            ip: getRequestIp(req),
            userAgent
        };
    }

    private getRefreshTokenFromRequest(req: Request) {
        const fromCookieParser = String((req as any).cookies?.[authConfig.refreshCookieName] || '').trim();
        if (fromCookieParser) return fromCookieParser;
        const source = String(req.headers.cookie || '');
        if (!source) return null;
        for (const part of source.split(';')) {
            const [rawKey, ...rest] = part.split('=');
            const key = String(rawKey || '').trim();
            if (key !== authConfig.refreshCookieName) continue;
            const value = String(rest.join('=') || '').trim();
            if (!value) return null;
            try {
                return decodeURIComponent(value);
            } catch {
                return value;
            }
        }
        return null;
    }

    private async buildAuthUserPayload(userId: number, preferredClubId?: number) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, role: true, dni: true }
        });

        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        const memberships = await getMembershipsForUser(user.id);
        const activeMembership = await resolveActiveMembership(user.id, preferredClubId);
        const resolvedClubId = activeMembership?.clubId ?? null;

        return {
            user,
            payload: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNumber: user.phoneNumber,
                role: user.role,
                clubId: resolvedClubId,
                memberships,
                activeClubId: resolvedClubId,
                activeMembership,
                club: activeMembership?.club ?? null,
                dni: user.dni
            }
        };
    }

    private async issueAuthPayload(userId: number, res: Response, req: Request, preferredClubId?: number) {
        const authUser = await this.buildAuthUserPayload(userId, preferredClubId);
        let token: string | null = null;

        if (authConfig.enableCookieSessions) {
            const sessionBundle = await this.authSessionService.issueSession({
                userId: authUser.user.id,
                role: authUser.user.role,
                meta: this.getRequestMeta(req)
            });
            this.setSessionCookies(res, sessionBundle.accessToken, sessionBundle.refreshToken);
            if (authConfig.allowBearerLegacy) {
                token = sessionBundle.accessToken;
            }
        } else {
            token = this.authTokenService.signAccessToken({
                userId: authUser.user.id,
                role: authUser.user.role
            });
        }

        return token
            ? { token, user: authUser.payload }
            : { user: authUser.payload };
    }

    private getVerifyRedirectUrl(req: Request, params: { token?: string; reason?: VerifyFailureReason }) {
        const base = getFrontendBaseUrl(req);
        const hash = new URLSearchParams();
        if (params.token) {
            hash.set('magic_token', params.token);
        }
        if (params.reason) {
            hash.set('magic_error', params.reason);
        }
        const hashSuffix = hash.toString() ? `#${hash.toString()}` : '';
        return `${base}/login${hashSuffix}`;
    }

    private isJsonVerifyRequest(req: Request): boolean {
        return String(req.query.format || '').toLowerCase() === 'json';
    }

    register = async (req: Request, res: Response) => {
        const registerSchema = z.object({
            firstName: z.string().min(1),
            lastName: z.string().min(1),
            email: z.string().email(),
            password: z.string().min(6),
            phoneNumber: z.string().trim().optional(),
            phoneCountryCode: z.string().trim().optional(),
            phoneNumberLocal: z.string().trim().optional(),
            role: z.enum(["MEMBER", "ADMIN"]).optional(),
            dni: z.string().min(7, "El DNI es muy corto").optional()
        }).superRefine((value, ctx) => {
            const hasFullPhone = String(value.phoneNumber || '').trim().length > 0;
            const hasLocal = String(value.phoneNumberLocal || '').trim().length > 0;
            if (!hasFullPhone && !hasLocal) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['phoneNumber'],
                    message: 'Debes ingresar un teléfono'
                });
            }
        });
        
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }
        
        const { firstName, lastName, email, password, phoneNumber, phoneCountryCode, phoneNumberLocal, dni } = parsed.data;
        const normalizedPhoneNumber = normalizeIdentityPhone({
            phone: phoneNumber,
            countryCode: phoneCountryCode,
            phoneNumberLocal
        });
        if (!normalizedPhoneNumber) {
            return res.status(400).json({ error: 'Número de teléfono inválido' });
        }
        
        try {
            const normalizedUserEmail = normalizeEmail(email);
            const existingUser = await prisma.user.findUnique({ where: { email: normalizedUserEmail } });
            if (existingUser) {
                return res.status(400).json({ error: "El email ya está registrado" });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            const newUser = await prisma.user.create({
                data: {
                    firstName, 
                    lastName, 
                    email: normalizedUserEmail, 
                    phoneNumber: normalizedPhoneNumber,
                    password: hashedPassword,
                    role: 'MEMBER',
                    dni 
                }
            });
            return res.status(201).json({ message: "Usuario creado", userId: newUser.id });
        } catch (error: any) {
            logger.error({ err: error, action: 'register' }, 'Error registrando usuario');
            return res.status(500).json({ error: 'No se pudo completar el registro.' });
        }
    }

    login = async (req: Request, res: Response) => {
        const loginSchema = z.object({
            email: z.string().email(),
            password: z.string().min(1)
        });
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }
        const normalizedUserEmail = normalizeEmail(parsed.data.email);
        const { password } = parsed.data;

        try {
            const user = await prisma.user.findUnique({ where: { email: normalizedUserEmail } });
            if (!user) {
                return res.status(400).json({ error: "Credenciales inválidas" });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(400).json({ error: "Credenciales inválidas" });
            }

            await prisma.user.update({
                where: { id: user.id },
                data: { lastLoginAt: new Date() },
                select: { id: true }
            });

            const payload = await this.issueAuthPayload(user.id, res, req);
            return res.json({
                message: "Login exitoso",
                ...payload
            });
        } catch (error: any) {
            logger.error({ err: error, action: 'login' }, 'Error iniciando sesión');
            return res.status(500).json({ error: 'No se pudo iniciar sesión en este momento.' });
        }
    }

    requestEmailMagicLink = async (req: Request, res: Response) => {
        const schema = z.object({
            email: z.string().email()
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }

        const normalizedUserEmail = normalizeEmail(parsed.data.email);
        const token = generateMagicLinkToken();
        const tokenHash = hashMagicLinkToken(token);
        const expiresAt = getMagicLinkExpiresAt();
        const ttlMinutes = getMagicLinkTtlMinutes();
        const ip = getRequestIp(req);
        const userAgent = String(req.headers['user-agent'] || '').trim() || null;
        const now = new Date();

        try {
            await prisma.$transaction(async (tx) => {
                await tx.magicLoginToken.updateMany({
                    where: {
                        email: normalizedUserEmail,
                        consumedAt: null
                    },
                    data: {
                        consumedAt: now
                    }
                });

                await tx.magicLoginToken.create({
                    data: {
                        email: normalizedUserEmail,
                        tokenHash,
                        expiresAt,
                        ip,
                        userAgent
                    }
                });
            });

            const frontendBaseUrl = getFrontendBaseUrl(req);
            const verifyUrl = `${frontendBaseUrl}/login#magic_token=${encodeURIComponent(token)}`;
            await this.getAuthEmailService().sendMagicLink(normalizedUserEmail, verifyUrl, ttlMinutes);
            return res.json({ message: MAGIC_LINK_NEUTRAL_MESSAGE });
        } catch (error) {
            logger.error(
                {
                    err: error,
                    action: 'requestEmailMagicLink',
                    email: normalizedUserEmail
                },
                'Error enviando magic link'
            );
            return res.status(500).json({ error: 'No se pudo procesar la solicitud en este momento.' });
        }
    };

    verifyEmailMagicLink = async (req: Request, res: Response) => {
        const token = String(req.query.token || '').trim();
        const expectsJson = this.isJsonVerifyRequest(req);
        if (!token) {
            if (expectsJson) {
                return res.status(400).json({ error: 'Enlace inválido o expirado.' });
            }
            return res.redirect(302, this.getVerifyRedirectUrl(req, { reason: 'invalid_or_expired' }));
        }

        const tokenHash = hashMagicLinkToken(token);
        const now = new Date();
        const fallbackPasswordHash = await bcrypt.hash(generateMagicLinkToken(), 10);

        try {
            const result = await prisma.$transaction(async (tx) => {
                const stored = await tx.magicLoginToken.findUnique({
                    where: { tokenHash },
                    select: { id: true, email: true, expiresAt: true, consumedAt: true }
                });

                if (!stored) {
                    return { ok: false as const, reason: 'invalid_or_expired' as VerifyFailureReason };
                }

                if (stored.consumedAt || stored.expiresAt <= now) {
                    return { ok: false as const, reason: 'invalid_or_expired' as VerifyFailureReason };
                }

                const consumeResult = await tx.magicLoginToken.updateMany({
                    where: {
                        id: stored.id,
                        consumedAt: null,
                        expiresAt: { gt: now }
                    },
                    data: {
                        consumedAt: now
                    }
                });

                if (consumeResult.count !== 1) {
                    return { ok: false as const, reason: 'invalid_or_expired' as VerifyFailureReason };
                }

                const existingUser = await tx.user.findUnique({
                    where: { email: stored.email },
                    select: { id: true, emailVerifiedAt: true }
                });

                if (existingUser) {
                    const updated = await tx.user.update({
                        where: { id: existingUser.id },
                        data: {
                            emailVerifiedAt: existingUser.emailVerifiedAt ?? now,
                            lastLoginAt: now
                        },
                        select: { id: true }
                    });
                    return { ok: true as const, userId: updated.id };
                }

                const created = await tx.user.create({
                    data: {
                        email: stored.email,
                        password: fallbackPasswordHash,
                        firstName: DEFAULT_MAGIC_LINK_USER_FIRST_NAME,
                        lastName: DEFAULT_MAGIC_LINK_USER_LAST_NAME,
                        phoneNumber: DEFAULT_MAGIC_LINK_USER_PHONE,
                        role: 'MEMBER',
                        emailVerifiedAt: now,
                        lastLoginAt: now
                    },
                    select: { id: true }
                });
                return { ok: true as const, userId: created.id };
            });

            if (!result.ok) {
                if (expectsJson) {
                    return res.status(400).json({ error: 'Enlace inválido o expirado.' });
                }
                return res.redirect(302, this.getVerifyRedirectUrl(req, { reason: result.reason }));
            }

            const payload = await this.issueAuthPayload(result.userId, res, req);
            if (expectsJson) {
                return res.json({
                    message: 'Login exitoso',
                    ...payload
                });
            }

            const legacyToken = typeof (payload as any)?.token === 'string' ? String((payload as any).token) : undefined;
            return res.redirect(302, this.getVerifyRedirectUrl(req, { token: legacyToken }));
        } catch (error) {
            logger.error(
                {
                    err: error,
                    action: 'verifyEmailMagicLink'
                },
                'Error validando magic link'
            );
            if (expectsJson) {
                return res.status(500).json({ error: 'No se pudo validar el enlace en este momento.' });
            }
            return res.redirect(302, this.getVerifyRedirectUrl(req, { reason: 'internal_error' }));
        }
    };

    getMe = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
        }
        try {
            const sessionId = String(payload?.sid || '').trim() || null;
            await this.authSessionService.touchSession(sessionId);

            const user = await prisma.user.findUnique({
                where: { id: payload.userId },
                select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, role: true, dni: true }
            });
            if (!user) {
                return sendAuthError(res, 401, 'AUTH_INVALID', 'Usuario no encontrado');
            }

            const memberships = await getMembershipsForUser(user.id);
            let preferredClubId: number | undefined;
            try {
                preferredClubId = getPreferredClubIdFromRequest(req);
            } catch (error: any) {
                return sendAuthError(res, 400, 'AUTH_CONTEXT_INVALID', error?.message || 'Contexto de club inválido');
            }
            const activeMembership = await resolveActiveMembership(user.id, preferredClubId);
            const clubId = activeMembership?.clubId ?? null;
            const club = activeMembership?.club ?? null;

            return res.json({
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNumber: user.phoneNumber,
                role: user.role,
                clubId,
                memberships,
                activeClubId: clubId,
                activeMembership,
                dni: user.dni,
                club
            });
        } catch (error: any) {
            logger.error({ err: error, action: 'getMe' }, 'Error consultando sesión actual');
            return res.status(500).json({ error: 'No se pudo consultar la sesión actual.' });
        }
    };

    updateMe = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
        }

        const updateSchema = z.object({
            firstName: z.string().trim().min(1, 'El nombre es obligatorio'),
            lastName: z.string().trim().min(1, 'El apellido es obligatorio'),
            phoneNumber: z.string().trim().optional(),
            phoneCountryCode: z.string().trim().optional(),
            phoneNumberLocal: z.string().trim().optional(),
            dni: z.string().trim().optional().nullable()
        }).superRefine((value, ctx) => {
            const hasFullPhone = String(value.phoneNumber || '').trim().length > 0;
            const hasLocal = String(value.phoneNumberLocal || '').trim().length > 0;
            if (!hasFullPhone && !hasLocal) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['phoneNumber'],
                    message: 'Debes ingresar un teléfono'
                });
            }
        });

        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }

        const { firstName, lastName, phoneNumber, phoneCountryCode, phoneNumberLocal, dni } = parsed.data;
        const normalizedPhoneNumber = normalizeIdentityPhone({
            phone: phoneNumber,
            countryCode: phoneCountryCode,
            phoneNumberLocal
        });
        if (!normalizedPhoneNumber) {
            return res.status(400).json({ error: 'Número de teléfono inválido' });
        }

        const sanitizedDni = String(dni ?? '').trim();
        if (sanitizedDni && sanitizedDni.length < 7) {
            return res.status(400).json({ error: 'Si cargás DNI, debe tener al menos 7 dígitos' });
        }

        try {
            const sessionId = String(payload?.sid || '').trim() || null;
            await this.authSessionService.touchSession(sessionId);

            const user = await prisma.user.update({
                where: { id: payload.userId },
                data: {
                    firstName,
                    lastName,
                    phoneNumber: normalizedPhoneNumber,
                    dni: sanitizedDni || null
                },
                select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, role: true, dni: true }
            });

            const memberships = await getMembershipsForUser(user.id);
            let preferredClubId: number | undefined;
            try {
                preferredClubId = getPreferredClubIdFromRequest(req);
            } catch (error: any) {
                return sendAuthError(res, 400, 'AUTH_CONTEXT_INVALID', error?.message || 'Contexto de club inválido');
            }
            const activeMembership = await resolveActiveMembership(user.id, preferredClubId);
            const clubId = activeMembership?.clubId ?? null;
            const club = activeMembership?.club ?? null;

            return res.json({
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNumber: user.phoneNumber,
                role: user.role,
                clubId,
                memberships,
                activeClubId: clubId,
                activeMembership,
                dni: user.dni,
                club
            });
        } catch (error: any) {
            logger.error({ err: error, action: 'updateMe' }, 'Error actualizando perfil');
            return res.status(500).json({ error: 'No se pudo actualizar el perfil.' });
        }
    };

    sessionMe = async (req: Request, res: Response) => {
        return this.getMe(req, res);
    };

    sessionRefresh = async (req: Request, res: Response) => {
        try {
            const refreshToken = this.getRefreshTokenFromRequest(req);
            if (!refreshToken) {
                this.clearSessionCookies(res);
                return sendAuthError(res, 401, 'AUTH_MISSING', 'No hay sesión activa para refrescar.');
            }

            const rotated = await this.authSessionService.rotateSession({
                refreshToken,
                meta: this.getRequestMeta(req)
            });

            if (!rotated.ok) {
                this.clearSessionCookies(res);
                return sendAuthError(res, 401, rotated.reason, 'No se pudo refrescar la sesión.');
            }

            this.setSessionCookies(res, rotated.accessToken, rotated.refreshToken);
            return res.status(204).send();
        } catch (error: any) {
            logger.error({ err: error, action: 'sessionRefresh' }, 'Error refrescando sesión');
            return res.status(500).json({ error: 'No se pudo refrescar la sesión.' });
        }
    };

    sessionLogout = async (req: Request, res: Response) => {
        try {
            const refreshToken = this.getRefreshTokenFromRequest(req);
            const sessionId = String((req as any)?.user?.sid || '').trim() || null;

            await Promise.all([
                this.authSessionService.revokeCurrentSessionByRefreshToken(refreshToken),
                this.authSessionService.revokeSessionById(sessionId)
            ]);

            this.clearSessionCookies(res);
            return res.status(204).send();
        } catch (error: any) {
            logger.error({ err: error, action: 'sessionLogout' }, 'Error cerrando sesión actual');
            return res.status(500).json({ error: 'No se pudo cerrar la sesión.' });
        }
    };

    sessionLogoutAll = async (req: Request, res: Response) => {
        try {
            const userId = Number((req as any)?.user?.userId || 0);
            if (!Number.isInteger(userId) || userId <= 0) {
                this.clearSessionCookies(res);
                return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
            }

            await this.authSessionService.revokeAllUserSessions(userId);
            this.clearSessionCookies(res);
            return res.status(204).send();
        } catch (error: any) {
            logger.error({ err: error, action: 'sessionLogoutAll' }, 'Error cerrando todas las sesiones');
            return res.status(500).json({ error: 'No se pudieron cerrar las sesiones.' });
        }
    };
}
