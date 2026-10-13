import { Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { getUserClubContext } from '../utils/getUserClubContext';
import { getPreferredClubIdFromRequest } from '../utils/clubContext';
import { normalizeIdentityPhone } from '../utils/phone';
import { logger } from '../utils/logger';
import { AuthEmailService } from '../services/AuthEmailService';
import { authConfig } from '../utils/authConfig';
import { AuthSessionService } from '../services/AuthSessionService';
import { AuthTokenService } from '../services/AuthTokenService';
import { GoogleOAuthService } from '../services/GoogleOAuthService';
import { AppleOAuthService } from '../services/AppleOAuthService';
import { FacebookOAuthService } from '../services/FacebookOAuthService';
import { UserClubProfileService } from '../services/UserClubProfileService';
import { AccountVerificationService } from '../services/AccountVerificationService';
import { looksLikeDni, normalizeDni } from '../utils/dni';
import {
    generateMagicLinkToken,
    getMagicLinkExpiresAt,
    getMagicLinkTtlMinutes,
    hashMagicLinkToken,
    normalizeEmail
} from '../utils/magicLink';
import { sendAuthError } from '../utils/authError';
import { ErrorCodes, notFound } from '../errors';
import { ensureCsrfToken } from '../utils/csrf';
const MAGIC_LINK_NEUTRAL_MESSAGE = 'Si el email es válido, te enviamos un enlace para ingresar.';
const DEFAULT_MAGIC_LINK_USER_FIRST_NAME = 'Nuevo';
const DEFAULT_MAGIC_LINK_USER_LAST_NAME = 'Usuario';
const DEFAULT_MAGIC_LINK_USER_PHONE = '+0000000000';
const GOOGLE_OAUTH_STATE_COOKIE_NAME = 'tc_google_oauth_state';

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

const normalizeOAuthReturnTo = (value: string | null | undefined, fallback = '/') => {
    const raw = String(value || '').trim();
    if (!raw.startsWith('/')) return fallback;
    if (raw.startsWith('//')) return fallback;
    return raw;
};

type VerifyFailureReason = 'invalid_or_expired' | 'internal_error';

export class AuthController {
    private authEmailService: AuthEmailService | null = null;
    private authSessionService = new AuthSessionService();
    private authTokenService = new AuthTokenService();
    private googleOAuthService = new GoogleOAuthService();
    private appleOAuthService = new AppleOAuthService();
    private facebookOAuthService = new FacebookOAuthService();
    private userClubProfileService = new UserClubProfileService();
    private accountVerificationService = new AccountVerificationService();

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
        res.clearCookie(authConfig.csrfCookieName, {
            httpOnly: false,
            secure: authConfig.cookieSecure,
            sameSite: authConfig.cookieSameSite,
            domain: authConfig.cookieDomain,
            path: '/'
        });
    }

    private setGoogleOAuthStateCookie(res: Response, state: string) {
        res.cookie(GOOGLE_OAUTH_STATE_COOKIE_NAME, state, {
            ...this.getCookieBaseOptions(),
            maxAge: this.googleOAuthService.getStateTtlMs()
        });
    }

    private clearGoogleOAuthStateCookie(res: Response) {
        res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE_NAME, this.getCookieBaseOptions());
    }

    private getGoogleOAuthStateFromRequest(req: Request) {
        const fromCookieParser = String((req as any).cookies?.[GOOGLE_OAUTH_STATE_COOKIE_NAME] || '').trim();
        if (fromCookieParser) return fromCookieParser;
        const source = String(req.headers.cookie || '');
        if (!source) return null;
        for (const part of source.split(';')) {
            const [rawKey, ...rest] = part.split('=');
            const key = String(rawKey || '').trim();
            if (key !== GOOGLE_OAUTH_STATE_COOKIE_NAME) continue;
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

    private getOAuthLoginRedirectUrl(req: Request, params?: {
        error?: string;
        provider?: string;
        returnTo?: string | null;
    }) {
        const base = getFrontendBaseUrl(req);
        const url = new URL('/login', base);
        const provider = String(params?.provider || 'google').trim();
        const error = String(params?.error || '').trim();
        const returnTo = this.googleOAuthService.normalizeReturnTo(params?.returnTo);

        if (provider) {
            url.searchParams.set('oauth_provider', provider);
        }
        if (error) {
            url.searchParams.set('oauth_error', error);
        }
        if (returnTo && returnTo !== '/') {
            url.searchParams.set('from', returnTo);
        }

        return url.toString();
    }

    private getOAuthErrorRedirectUrl(req: Request, params?: {
        error?: string;
        provider?: string;
        returnTo?: string | null;
        intent?: 'login' | 'connect' | null;
    }) {
        if (params?.intent === 'connect') {
            const base = getFrontendBaseUrl(req);
            const returnTo = normalizeOAuthReturnTo(params?.returnTo, '/perfil');
            const url = new URL(returnTo, `${base.replace(/\/+$/, '')}/`);
            const provider = String(params?.provider || '').trim();
            const error = String(params?.error || '').trim();
            if (provider) {
                url.searchParams.set('oauth_provider', provider);
            }
            if (error) {
                url.searchParams.set('oauth_error', error);
            }
            return url.toString();
        }
        return this.getOAuthLoginRedirectUrl(req, params);
    }

    private getOAuthSuccessRedirectUrl(req: Request, returnTo?: string | null) {
        const base = getFrontendBaseUrl(req);
        const safeReturnTo = this.googleOAuthService.normalizeReturnTo(returnTo);
        return new URL(safeReturnTo, `${base.replace(/\/+$/, '')}/`).toString();
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
            throw notFound('Usuario no encontrado', ErrorCodes.AUTH_INVALID);
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
            ensureCsrfToken(req, res);
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
            return sendAppError(
                res,
                zodValidationAppError(parsed.error, 'Revisá los campos marcados.', {
                    firstName: 'firstName',
                    lastName: 'lastName',
                    email: 'email',
                    password: 'password',
                    phoneNumber: 'phoneNumber',
                    dni: 'dni'
                }),
                'No se pudo validar el registro.'
            );
        }
        
        const { firstName, lastName, email, password, phoneNumber, phoneCountryCode, phoneNumberLocal, dni } = parsed.data;
        const normalizedPhoneNumber = normalizeIdentityPhone({
            phone: phoneNumber,
            countryCode: phoneCountryCode,
            phoneNumberLocal
        });
        if (!normalizedPhoneNumber) {
            return sendAppError(
                res,
                validationError('Revisá los campos marcados.', {
                    phoneNumber: 'Cargá un teléfono válido.'
                }),
                'No se pudo validar el registro.'
            );
        }
        
        // DNI opcional para no socios. Si viene, se normaliza y debe ser único.
        const rawDni = String(dni ?? '').trim();
        const normalizedDni = rawDni ? normalizeDni(rawDni) : null;
        if (rawDni && !normalizedDni) {
            return sendAppError(
                res,
                validationError('Revisá los campos marcados.', { dni: 'Ingresá un DNI válido (solo números).' }),
                'No se pudo validar el registro.'
            );
        }

        try {
            const normalizedUserEmail = normalizeEmail(email);
            const existingUser = await prisma.user.findUnique({ where: { email: normalizedUserEmail } });
            if (existingUser) {
                return res.status(400).json({ error: "El email ya está registrado" });
            }

            if (normalizedDni) {
                const existingDniUser = await prisma.user.findUnique({ where: { dni: normalizedDni }, select: { id: true } });
                if (existingDniUser) {
                    // No se crea otra cuenta ni se revela de quién es: se deriva a activar/recuperar,
                    // y el código va al contacto del titular de esa cuenta.
                    return res.status(409).json({
                        error: 'Ese DNI ya tiene una cuenta. Si sos vos, activala o recuperá tu contraseña.',
                        message: 'Ese DNI ya tiene una cuenta. Si sos vos, activala o recuperá tu contraseña.',
                        code: 'DNI_ALREADY_REGISTERED',
                        field: 'dni',
                        blocking: true
                    });
                }
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
                    dni: normalizedDni
                }
            });
            return res.status(201).json({ message: "Usuario creado", userId: newUser.id });
        } catch (error: any) {
            logger.error({ err: error, action: 'register' }, 'Error registrando usuario');
            return res.status(500).json({ error: 'No se pudo completar el registro.' });
        }
    }

    login = async (req: Request, res: Response) => {
        // `identifier` acepta DNI o email. `email` se mantiene por compatibilidad con clientes viejos.
        const loginSchema = z.object({
            identifier: z.string().trim().min(1).optional(),
            email: z.string().trim().min(1).optional(),
            password: z.string().min(1)
        }).refine((value) => Boolean(value.identifier || value.email), {
            path: ['identifier'],
            message: 'Ingresá tu DNI o email'
        });
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            return sendAppError(
                res,
                zodValidationAppError(parsed.error, 'Revisá los campos marcados.', {
                    identifier: 'identifier',
                    email: 'identifier',
                    password: 'password'
                }),
                'No se pudo validar el login.'
            );
        }
        const rawIdentifier = String(parsed.data.identifier || parsed.data.email || '').trim();
        const { password } = parsed.data;

        try {
            const user = await this.findUserByLoginIdentifier(rawIdentifier);
            if (!user) {
                return res.status(400).json({ error: "Credenciales inválidas" });
            }

            if (user.accountStatus === 'PENDING_ACTIVATION') {
                return sendAuthError(
                    res,
                    403,
                    'ACCOUNT_PENDING_ACTIVATION',
                    'Tu cuenta de socio todavía no está activada. Activala con tu DNI para elegir tu contraseña.'
                );
            }
            if (user.accountStatus === 'DISABLED') {
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

    private async findUserByLoginIdentifier(identifier: string) {
        const raw = String(identifier || '').trim();
        if (!raw) return null;
        if (looksLikeDni(raw)) {
            const dni = normalizeDni(raw);
            return dni ? prisma.user.findUnique({ where: { dni } }) : null;
        }
        return prisma.user.findUnique({ where: { email: normalizeEmail(raw) } });
    }

    // Respuesta idéntica exista o no la cuenta: no revela qué DNI o email están registrados ni quién es socio.
    private sendGenericCodeRequestResponse(res: Response) {
        return res.status(202).json({
            message: 'Si los datos corresponden a una cuenta, te enviamos un código para continuar.'
        });
    }

    private readonly passwordSchema = z.string().min(6, 'La contraseña debe tener al menos 6 caracteres');

    // AuditLog es por club: se registra en el club que pre-creó la cuenta; si no hay, queda en el log.
    private async auditUserAccountEvent(userId: number, action: string, payload: Record<string, unknown>) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdByClubId: true } });
        if (user?.createdByClubId) {
            await prisma.auditLog.create({
                data: {
                    clubId: user.createdByClubId,
                    userId,
                    entity: 'USER',
                    entityId: String(userId),
                    action,
                    payload: payload as any
                }
            });
            return;
        }
        logger.info({ userId, action, ...payload }, 'User account event');
    }

    // Primer ingreso de un socio importado desde el padrón: pide el código por WhatsApp.
    requestAccountActivation = async (req: Request, res: Response) => {
        const parsed = z.object({ dni: z.string().trim().min(1) }).safeParse(req.body);
        const dni = parsed.success ? normalizeDni(parsed.data.dni) : null;
        if (!dni) {
            return sendAppError(res, validationError('Revisá los campos marcados.', { dni: 'Ingresá un DNI válido.' }));
        }

        try {
            const user = await prisma.user.findUnique({ where: { dni }, select: { id: true, accountStatus: true } });
            if (user && user.accountStatus === 'PENDING_ACTIVATION') {
                const result = await this.accountVerificationService.issueCode({
                    userId: user.id,
                    purpose: 'ACTIVATION',
                    channel: 'WHATSAPP'
                });
                if (!result.ok) {
                    logger.warn({ userId: user.id, reason: result.reason, action: 'requestAccountActivation' }, 'No se envió código de activación');
                }
            }
            return this.sendGenericCodeRequestResponse(res);
        } catch (error: any) {
            logger.error({ err: error, action: 'requestAccountActivation' }, 'Error solicitando activación');
            return res.status(500).json({ error: 'No pudimos procesar la solicitud en este momento.' });
        }
    };

    confirmAccountActivation = async (req: Request, res: Response) => {
        const parsed = z.object({
            dni: z.string().trim().min(1),
            code: z.string().trim().min(1),
            password: this.passwordSchema
        }).safeParse(req.body);
        if (!parsed.success) {
            return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
        }
        const dni = normalizeDni(parsed.data.dni);
        const invalidCode = () => sendAppError(res, validationError('El código es inválido o venció.', { code: 'El código es inválido o venció.' }));
        if (!dni) return invalidCode();

        try {
            const user = await prisma.user.findUnique({ where: { dni }, select: { id: true, accountStatus: true } });
            if (!user || user.accountStatus !== 'PENDING_ACTIVATION') return invalidCode();

            const verification = await this.accountVerificationService.verifyCode({
                userId: user.id,
                purpose: 'ACTIVATION',
                code: parsed.data.code
            });
            if (!verification.ok) {
                return verification.reason === 'TOO_MANY_ATTEMPTS'
                    ? sendAppError(res, validationError('Superaste los intentos permitidos. Pedí un código nuevo.', { code: 'Pedí un código nuevo.' }))
                    : invalidCode();
            }

            const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
            await prisma.user.update({
                where: { id: user.id },
                data: { password: hashedPassword, accountStatus: 'ACTIVE', lastLoginAt: new Date() }
            });
            await this.auditUserAccountEvent(user.id, 'USER_ACCOUNT_ACTIVATED', { codeId: verification.codeId });

            const payload = await this.issueAuthPayload(user.id, res, req);
            return res.json({ message: 'Cuenta activada', ...payload });
        } catch (error: any) {
            logger.error({ err: error, action: 'confirmAccountActivation' }, 'Error activando cuenta');
            return res.status(500).json({ error: 'No pudimos activar la cuenta en este momento.' });
        }
    };

    // "Olvidé mi contraseña" por DNI o email. Email si la cuenta lo tiene; si no, WhatsApp por el club.
    requestPasswordReset = async (req: Request, res: Response) => {
        const parsed = z.object({ identifier: z.string().trim().min(1) }).safeParse(req.body);
        if (!parsed.success) {
            return sendAppError(res, validationError('Revisá los campos marcados.', { identifier: 'Ingresá tu DNI o email.' }));
        }

        try {
            const user = await this.findUserByLoginIdentifier(parsed.data.identifier);
            if (user && user.accountStatus !== 'DISABLED') {
                // Una cuenta pendiente se "recupera" activándola: mismo flujo, mismo código.
                const purpose = user.accountStatus === 'PENDING_ACTIVATION' ? 'ACTIVATION' : 'PASSWORD_RESET';
                const channel = user.email ? 'EMAIL' : 'WHATSAPP';
                const result = await this.accountVerificationService.issueCode({ userId: user.id, purpose, channel });
                if (!result.ok) {
                    logger.warn({ userId: user.id, reason: result.reason, action: 'requestPasswordReset' }, 'No se envió código de recuperación');
                }
            }
            return this.sendGenericCodeRequestResponse(res);
        } catch (error: any) {
            logger.error({ err: error, action: 'requestPasswordReset' }, 'Error solicitando recuperación');
            return res.status(500).json({ error: 'No pudimos procesar la solicitud en este momento.' });
        }
    };

    confirmPasswordReset = async (req: Request, res: Response) => {
        const parsed = z.object({
            identifier: z.string().trim().min(1),
            code: z.string().trim().min(1),
            password: this.passwordSchema
        }).safeParse(req.body);
        if (!parsed.success) {
            return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
        }
        const invalidCode = () => sendAppError(res, validationError('El código es inválido o venció.', { code: 'El código es inválido o venció.' }));

        try {
            const user = await this.findUserByLoginIdentifier(parsed.data.identifier);
            if (!user || user.accountStatus === 'DISABLED') return invalidCode();

            const purpose = user.accountStatus === 'PENDING_ACTIVATION' ? 'ACTIVATION' : 'PASSWORD_RESET';
            const verification = await this.accountVerificationService.verifyCode({ userId: user.id, purpose, code: parsed.data.code });
            if (!verification.ok) {
                return verification.reason === 'TOO_MANY_ATTEMPTS'
                    ? sendAppError(res, validationError('Superaste los intentos permitidos. Pedí un código nuevo.', { code: 'Pedí un código nuevo.' }))
                    : invalidCode();
            }

            const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
            await prisma.user.update({
                where: { id: user.id },
                data: { password: hashedPassword, accountStatus: 'ACTIVE', lastLoginAt: new Date() }
            });
            // Cambiar la contraseña cierra las demás sesiones.
            await this.authSessionService.revokeAllUserSessions(user.id);
            await this.auditUserAccountEvent(
                user.id,
                purpose === 'ACTIVATION' ? 'USER_ACCOUNT_ACTIVATED' : 'USER_PASSWORD_RESET',
                { codeId: verification.codeId }
            );

            const payload = await this.issueAuthPayload(user.id, res, req);
            return res.json({ message: 'Contraseña actualizada', ...payload });
        } catch (error: any) {
            logger.error({ err: error, action: 'confirmPasswordReset' }, 'Error recuperando contraseña');
            return res.status(500).json({ error: 'No pudimos actualizar la contraseña en este momento.' });
        }
    };

    requestEmailMagicLink = async (req: Request, res: Response) => {
        const schema = z.object({
            email: z.string().email()
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return sendAppError(
                res,
                zodValidationAppError(parsed.error, 'Revisá los campos marcados.', { email: 'email' }),
                'No se pudo validar el email.'
            );
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
                    select: { id: true, emailVerifiedAt: true, accountStatus: true }
                });

                if (existingUser) {
                    if (existingUser.accountStatus === 'DISABLED') {
                        return { ok: false as const, reason: 'invalid_or_expired' as VerifyFailureReason };
                    }
                    const updated = await tx.user.update({
                        where: { id: existingUser.id },
                        data: {
                            emailVerifiedAt: existingUser.emailVerifiedAt ?? now,
                            lastLoginAt: now,
                            // Probar el email activa una cuenta pre-creada por el club.
                            ...(existingUser.accountStatus === 'PENDING_ACTIVATION' ? { accountStatus: 'ACTIVE' as const } : {})
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

    startGoogleOAuth = async (req: Request, res: Response) => {
        try {
            const intent = req.query.intent === 'connect' ? 'connect' : 'login';
            if (!this.googleOAuthService.isConfigured()) {
                return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                    error: 'google_not_configured',
                    provider: 'google',
                    returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : null,
                    intent
                }));
            }

            const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : null;
            const state = this.googleOAuthService.createStateToken(returnTo, intent);
            const authorizationUrl = await this.googleOAuthService.buildAuthorizationUrl(state);
            this.setGoogleOAuthStateCookie(res, state);
            return res.redirect(302, authorizationUrl);
        } catch (error) {
            logger.error({ err: error, action: 'startGoogleOAuth' }, 'Error iniciando Google OAuth');
            this.clearGoogleOAuthStateCookie(res);
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: 'google_start_failed',
                provider: 'google',
                returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : null,
                intent: req.query.intent === 'connect' ? 'connect' : 'login'
            }));
        }
    };

    startAppleOAuth = async (req: Request, res: Response) => {
        try {
            const intent = req.query.intent === 'connect' ? 'connect' : 'login';
            if (!this.appleOAuthService.isConfigured()) {
                return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                    error: 'apple_not_configured',
                    provider: 'apple',
                    returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : null,
                    intent
                }));
            }

            const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : null;
            const state = await this.appleOAuthService.createState(returnTo, intent);
            const authorizationUrl = await this.appleOAuthService.buildAuthorizationUrl(state);
            return res.redirect(302, authorizationUrl);
        } catch (error) {
            logger.error({ err: error, action: 'startAppleOAuth' }, 'Error iniciando Apple OAuth');
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: 'apple_start_failed',
                provider: 'apple',
                returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : null,
                intent: req.query.intent === 'connect' ? 'connect' : 'login'
            }));
        }
    };

    startFacebookOAuth = async (req: Request, res: Response) => {
        try {
            const intent = req.query.intent === 'connect' ? 'connect' : 'login';
            if (!this.facebookOAuthService.isConfigured()) {
                return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                    error: 'facebook_not_configured',
                    provider: 'facebook',
                    returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : null,
                    intent
                }));
            }

            const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : null;
            const state = await this.facebookOAuthService.createState(returnTo, intent);
            const authorizationUrl = await this.facebookOAuthService.buildAuthorizationUrl(state);
            return res.redirect(302, authorizationUrl);
        } catch (error) {
            logger.error({ err: error, action: 'startFacebookOAuth' }, 'Error iniciando Facebook OAuth');
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: 'facebook_start_failed',
                provider: 'facebook',
                returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : null,
                intent: req.query.intent === 'connect' ? 'connect' : 'login'
            }));
        }
    };

    googleOAuthCallback = async (req: Request, res: Response) => {
        const provider = 'google';
        const oauthError = String(req.query.error || '').trim();
        const code = String(req.query.code || '').trim();
        const receivedState = String(req.query.state || '').trim();
        const expectedState = this.getGoogleOAuthStateFromRequest(req);
        let stateMeta: { returnTo: string; intent: 'login' | 'connect' } | null = null;

        if (receivedState && expectedState) {
            try {
                stateMeta = this.googleOAuthService.verifyStateToken(receivedState, expectedState);
            } catch {
                stateMeta = null;
            }
        }

        if (oauthError) {
            this.clearGoogleOAuthStateCookie(res);
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: oauthError === 'access_denied' ? 'google_access_denied' : 'google_callback_failed',
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
        }

        if (!code || !receivedState || !expectedState) {
            this.clearGoogleOAuthStateCookie(res);
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: 'google_state_invalid',
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
        }

        try {
            const result = await this.googleOAuthService.authenticateCallback({
                code,
                receivedState,
                expectedState,
                currentUserId: Number((req as any).user?.userId || 0) || null
            });
            this.clearGoogleOAuthStateCookie(res);
            if (result.intent === 'login') {
                await this.issueAuthPayload(result.userId, res, req);
            }
            return res.redirect(302, this.getOAuthSuccessRedirectUrl(req, result.returnTo));
        } catch (error: any) {
            logger.error({ err: error, action: 'googleOAuthCallback' }, 'Error completando Google OAuth');
            this.clearGoogleOAuthStateCookie(res);

            const errorCode = String(error?.message || '').trim();
            const mappedError =
                errorCode === 'GOOGLE_OAUTH_EMAIL_UNAVAILABLE'
                    ? 'google_email_unavailable'
                    : errorCode === 'GOOGLE_OAUTH_EMAIL_UNVERIFIED'
                    ? 'google_email_unverified'
                    : errorCode === 'GOOGLE_OAUTH_ALREADY_LINKED'
                    ? 'google_already_linked'
                    : errorCode === 'OAUTH_CONNECT_AUTH_REQUIRED'
                    ? 'oauth_connect_auth_required'
                    : errorCode === 'GOOGLE_OAUTH_STATE_INVALID'
                    ? 'google_state_invalid'
                    : errorCode === 'GOOGLE_OAUTH_CONFIG_INVALID'
                    ? 'google_not_configured'
                    : 'google_callback_failed';

            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: mappedError,
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
        }
    };

    appleOAuthCallback = async (req: Request, res: Response) => {
        const provider = 'apple';
        const body = (req.body && typeof req.body === 'object') ? req.body : {};
        const oauthError = String((body as any).error || req.query.error || '').trim();
        const code = String((body as any).code || req.query.code || '').trim();
        const receivedState = String((body as any).state || req.query.state || '').trim();
        const rawUser = (body as any).user ?? req.query.user;
        let stateMeta: { returnTo: string; intent: 'login' | 'connect' } | null = null;

        if (receivedState) {
            try {
                stateMeta = await this.appleOAuthService.inspectState(receivedState);
            } catch {
                stateMeta = null;
            }
        }

        if (oauthError) {
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: oauthError === 'access_denied' ? 'apple_access_denied' : 'apple_callback_failed',
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
        }

        if (!code || !receivedState) {
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: 'apple_state_invalid',
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
        }

        try {
            const result = await this.appleOAuthService.authenticateCallback({
                code,
                state: receivedState,
                user: rawUser,
                currentUserId: Number((req as any).user?.userId || 0) || null
            });
            if (result.intent === 'login') {
                await this.issueAuthPayload(result.userId, res, req);
            }
            return res.redirect(302, this.getOAuthSuccessRedirectUrl(req, result.returnTo));
        } catch (error: any) {
            logger.error({ err: error, action: 'appleOAuthCallback' }, 'Error completando Apple OAuth');

            const errorCode = String(error?.message || '').trim();
            const mappedError =
                errorCode === 'APPLE_OAUTH_EMAIL_UNAVAILABLE'
                    ? 'apple_email_unavailable'
                    : errorCode === 'APPLE_OAUTH_EMAIL_UNVERIFIED'
                    ? 'apple_email_unverified'
                    : errorCode === 'APPLE_OAUTH_ALREADY_LINKED'
                    ? 'apple_already_linked'
                    : errorCode === 'OAUTH_CONNECT_AUTH_REQUIRED'
                    ? 'oauth_connect_auth_required'
                    : errorCode === 'OAUTH_STATE_INVALID'
                    ? 'apple_state_invalid'
                    : errorCode === 'APPLE_OAUTH_CONFIG_INVALID'
                    ? 'apple_not_configured'
                    : 'apple_callback_failed';

            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: mappedError,
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
        }
    };

    facebookOAuthCallback = async (req: Request, res: Response) => {
        const provider = 'facebook';
        const oauthError = String(req.query.error || '').trim();
        const code = String(req.query.code || '').trim();
        const receivedState = String(req.query.state || '').trim();
        let stateMeta: { returnTo: string; intent: 'login' | 'connect' } | null = null;

        if (receivedState) {
            try {
                stateMeta = await this.facebookOAuthService.inspectState(receivedState);
            } catch {
                stateMeta = null;
            }
        }

        if (oauthError) {
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: oauthError === 'access_denied' ? 'facebook_access_denied' : 'facebook_callback_failed',
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
        }

        if (!code || !receivedState) {
            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: 'facebook_state_invalid',
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
        }

        try {
            const result = await this.facebookOAuthService.authenticateCallback({
                code,
                state: receivedState,
                currentUserId: Number((req as any).user?.userId || 0) || null
            });
            if (result.intent === 'login') {
                await this.issueAuthPayload(result.userId, res, req);
            }
            return res.redirect(302, this.getOAuthSuccessRedirectUrl(req, result.returnTo));
        } catch (error: any) {
            logger.error({ err: error, action: 'facebookOAuthCallback' }, 'Error completando Facebook OAuth');

            const errorCode = String(error?.message || '').trim();
            const mappedError =
                errorCode === 'FACEBOOK_OAUTH_EMAIL_UNAVAILABLE'
                    ? 'facebook_email_unavailable'
                    : errorCode === 'FACEBOOK_OAUTH_ALREADY_LINKED'
                    ? 'facebook_already_linked'
                    : errorCode === 'OAUTH_CONNECT_AUTH_REQUIRED'
                    ? 'oauth_connect_auth_required'
                    : errorCode === 'OAUTH_STATE_INVALID'
                    ? 'facebook_state_invalid'
                    : errorCode === 'FACEBOOK_OAUTH_CONFIG_INVALID'
                    ? 'facebook_not_configured'
                    : 'facebook_callback_failed';

            return res.redirect(302, this.getOAuthErrorRedirectUrl(req, {
                error: mappedError,
                provider,
                returnTo: stateMeta?.returnTo || null,
                intent: stateMeta?.intent || null
            }));
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
            } catch {
                return sendAuthError(res, 400, 'AUTH_CONTEXT_INVALID', 'Contexto de club inválido');
            }
            const activeMembership = await resolveActiveMembership(user.id, preferredClubId);
            const clubId = activeMembership?.clubId ?? null;
            const club = activeMembership?.club ?? null;
            ensureCsrfToken(req, res);

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
            return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
        }

        const { firstName, lastName, phoneNumber, phoneCountryCode, phoneNumberLocal, dni } = parsed.data;
        const normalizedPhoneNumber = normalizeIdentityPhone({
            phone: phoneNumber,
            countryCode: phoneCountryCode,
            phoneNumberLocal
        });
        if (!normalizedPhoneNumber) {
            return sendAppError(res, validationError('Revisá los campos marcados.', {
                phoneNumber: 'Cargá un teléfono válido.'
            }));
        }

        const rawDni = String(dni ?? '').trim();
        const sanitizedDni = rawDni ? normalizeDni(rawDni) : null;
        if (rawDni && !sanitizedDni) {
            return sendAppError(res, validationError('Revisá los campos marcados.', {
                dni: 'Ingresá un DNI válido (solo números).'
            }));
        }
        if (sanitizedDni) {
            const dniOwner = await prisma.user.findUnique({ where: { dni: sanitizedDni }, select: { id: true } });
            if (dniOwner && dniOwner.id !== Number(payload.userId)) {
                return sendAppError(res, validationError('Revisá los campos marcados.', {
                    dni: 'Ese DNI ya está asociado a otra cuenta.'
                }));
            }
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
            } catch {
                return sendAuthError(res, 400, 'AUTH_CONTEXT_INVALID', 'Contexto de club inválido');
            }
            const activeMembership = await resolveActiveMembership(user.id, preferredClubId);
            const clubId = activeMembership?.clubId ?? null;
            const club = activeMembership?.club ?? null;
            ensureCsrfToken(req, res);

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
            return sendAppError(res, error, 'No se pudo actualizar el perfil.');
        }
    };

    accountSecurityOverview = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
        }

        try {
            const userId = Number(payload.userId);
            const currentSessionId = String(payload?.sid || '').trim() || null;

            const [oauthIdentities, sessions, clubProfiles] = await Promise.all([
                prisma.userOAuthIdentity.findMany({
                    where: { userId },
                    orderBy: [{ linkedAt: 'asc' }],
                    select: {
                        id: true,
                        provider: true,
                        providerEmail: true,
                        providerEmailVerified: true,
                        profilePhotoUrl: true,
                        linkedAt: true,
                        lastLoginAt: true
                    }
                }),
                this.authSessionService.listUserSessions(userId, currentSessionId),
                this.userClubProfileService.listUserClubProfiles(userId)
            ]);

            return res.json({
                oauthIdentities,
                sessions,
                currentSessionId,
                clubProfiles
            });
        } catch (error: any) {
            logger.error({ err: error, action: 'accountSecurityOverview' }, 'Error consultando seguridad de cuenta');
            return res.status(500).json({ error: 'No se pudo consultar la seguridad de la cuenta.' });
        }
    };

    disconnectGoogleOAuth = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
        }

        try {
            const userId = Number(payload.userId);
            await prisma.userOAuthIdentity.deleteMany({
                where: {
                    userId,
                    provider: 'GOOGLE'
                }
            });
            return res.status(204).send();
        } catch (error: any) {
            logger.error({ err: error, action: 'disconnectGoogleOAuth' }, 'Error desconectando Google OAuth');
            return res.status(500).json({ error: 'No se pudo desconectar Google en este momento.' });
        }
    };

    disconnectAppleOAuth = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
        }

        try {
            const userId = Number(payload.userId);
            await prisma.userOAuthIdentity.deleteMany({
                where: {
                    userId,
                    provider: 'APPLE'
                }
            });
            return res.status(204).send();
        } catch (error: any) {
            logger.error({ err: error, action: 'disconnectAppleOAuth' }, 'Error desconectando Apple OAuth');
            return res.status(500).json({ error: 'No se pudo desconectar Apple en este momento.' });
        }
    };

    disconnectFacebookOAuth = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
        }

        try {
            const userId = Number(payload.userId);
            await prisma.userOAuthIdentity.deleteMany({
                where: {
                    userId,
                    provider: 'FACEBOOK'
                }
            });
            return res.status(204).send();
        } catch (error: any) {
            logger.error({ err: error, action: 'disconnectFacebookOAuth' }, 'Error desconectando Facebook OAuth');
            return res.status(500).json({ error: 'No se pudo desconectar Facebook en este momento.' });
        }
    };

    claimClubProfile = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
        }

        const clubId = Number(req.params.clubId || 0);
        if (!Number.isInteger(clubId) || clubId <= 0) {
            return res.status(400).json({ error: 'Club inválido.' });
        }

        try {
            const profile = await this.userClubProfileService.claimClubProfile(Number(payload.userId), clubId);
            return res.json({ profile });
        } catch (error: any) {
            logger.error({ err: error, action: 'claimClubProfile', clubId }, 'Error reclamando perfil de club');
            return sendAppError(res, error, 'No se pudo reclamar el perfil del club.');
        }
    };

    sessionMe = async (req: Request, res: Response) => {
        return this.getMe(req, res);
    };

    csrfToken = async (req: Request, res: Response) => {
        const csrfToken = ensureCsrfToken(req, res);
        return res.json({ csrfToken });
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
            ensureCsrfToken(req, res);
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
