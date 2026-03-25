import { Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getUserClubContext } from '../utils/getUserClubContext';
import { getPreferredClubIdFromRequest } from '../utils/clubContext';
import { normalizeIdentityPhone } from '../utils/phone';

const JWT_SECRET = process.env.JWT_SECRET as string;

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

// Asegurate de tener importados z, prisma, bcrypt y jwt arriba en tu archivo

export class AuthController {
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
            dni: z.string().min(7, "El DNI es muy corto").optional() // Dejalo opcional o sacale el .optional() si es obligatorio
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
        
        // 👉 2. DESESTRUCTURAMOS EL DNI
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
            const existingUser = await prisma.user.findUnique({ where: { email } });
            if (existingUser) {
                return res.status(400).json({ error: "El email ya está registrado" });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            const newUser = await prisma.user.create({
                data: {
                    firstName, 
                    lastName, 
                    email, 
                    phoneNumber: normalizedPhoneNumber,
                    password: hashedPassword,
                    role: 'MEMBER',
                    dni 
                }
            });
            res.status(201).json({ message: "Usuario creado", userId: newUser.id });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
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
        const { email, password } = parsed.data;
        try {
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return res.status(400).json({ error: "Credenciales inválidas" });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(400).json({ error: "Credenciales inválidas" });
            }

            const token = jwt.sign(
                { userId: user.id, role: user.role },
                JWT_SECRET,
                { expiresIn: '6h' }
            );

            const memberships = await getMembershipsForUser(user.id);
            const activeMembership = await resolveActiveMembership(user.id);
            const resolvedClubId = activeMembership?.clubId ?? null;

            res.json({ 
                message: "Login exitoso", 
                token,
                user: {
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
                    // 👉 4. ENVIAMOS EL DNI AL FRONTEND AL LOGUEARSE
                    dni: user.dni
                } 
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    /** GET /me: valida el token y devuelve el usuario actual (para rutas protegidas). */
    getMe = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        try {
            const user = await prisma.user.findUnique({
                where: { id: payload.userId },
                // 👉 5. PEDIMOS QUE LA BD NOS TRAIGA EL DNI TAMBIÉN ACÁ
                select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, role: true, dni: true }
            });
            if (!user) {
                return res.status(401).json({ error: 'Usuario no encontrado' });
            }

            const memberships = await getMembershipsForUser(user.id);
            let preferredClubId: number | undefined;
            try {
                preferredClubId = getPreferredClubIdFromRequest(req);
            } catch (error: any) {
                return res.status(400).json({ error: error?.message || 'Contexto de club inválido' });
            }
            const activeMembership = await resolveActiveMembership(user.id, preferredClubId);
            const clubId = activeMembership?.clubId ?? null;
            const club = activeMembership?.club ?? null;

            res.json({
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
                // 👉 6. LO DEVOLVEMOS AL FRONTEND
                dni: user.dni,
                club
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    /** PATCH /me: actualiza datos básicos del perfil autenticado. */
    updateMe = async (req: Request, res: Response) => {
        const payload = (req as any).user;
        if (!payload?.userId) {
            return res.status(401).json({ error: 'No autorizado' });
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
                return res.status(400).json({ error: error?.message || 'Contexto de club inválido' });
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
            return res.status(500).json({ error: error.message || 'No se pudo actualizar el perfil' });
        }
    };
}
