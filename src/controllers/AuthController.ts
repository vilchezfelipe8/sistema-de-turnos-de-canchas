import { Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'MI_SECRETO_SUPER_SECRETO_123'; // En la vida real esto va en .env

export class AuthController {

    // REGISTRO
    register = async (req: Request, res: Response) => {
        try {
            const { firstName, lastName, email, password, phoneNumber } = req.body;

            // 1. Verificar si ya existe
            const existingUser = await prisma.user.findUnique({ where: { email } });
            if (existingUser) {
                return res.status(400).json({ error: "El email ya está registrado" });
            }

            // 2. Encriptar contraseña
            const hashedPassword = await bcrypt.hash(password, 10);

            // 3. Guardar en BD
            const newUser = await prisma.user.create({
                data: {
                    firstName, lastName, email, phoneNumber,
                    password: hashedPassword, // <--- Guardamos la encriptada
                    role: 'MEMBER'
                }
            });

            res.status(201).json({ message: "Usuario creado", userId: newUser.id });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    // LOGIN
    login = async (req: Request, res: Response) => {
        try {
            const { email, password } = req.body;

            // 1. Buscar usuario por email
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return res.status(400).json({ error: "Credenciales inválidas" });
            }

            // 2. Comparar contraseña (Input vs Base de Datos)
            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(400).json({ error: "Credenciales inválidas" });
            }

            // 3. Generar el TOKEN (El "Carnet")
            const token = jwt.sign(
                { userId: user.id, role: user.role }, 
                JWT_SECRET, 
                { expiresIn: '24h' }
            );

            // Devolvemos el token al usuario
            res.json({ message: "Login exitoso", token });

        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}