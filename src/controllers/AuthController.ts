import { Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const JWT_SECRET = process.env.JWT_SECRET as string;

export class AuthController {
    register = async (req: Request, res: Response) => {
        const registerSchema = z.object({
            firstName: z.string().min(1),
            lastName: z.string().min(1),
            email: z.string().email(),
            password: z.string().min(6),
            phoneNumber: z.string().min(5)
        });
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.format() });
        }
        const { firstName, lastName, email, password, phoneNumber } = parsed.data;
        try {
            const existingUser = await prisma.user.findUnique({ where: { email } });
            if (existingUser) {
                return res.status(400).json({ error: "El email ya está registrado" });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            const newUser = await prisma.user.create({
                data: {
                    firstName, lastName, email, phoneNumber,
                    password: hashedPassword,
                    role: 'MEMBER'
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
                { expiresIn: '24h' }
            );

            res.json({ message: "Login exitoso", token });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}