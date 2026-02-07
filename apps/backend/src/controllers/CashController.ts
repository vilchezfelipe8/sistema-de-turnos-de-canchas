import { Request, Response } from 'express';
import { CashService } from '../services/CashService';

export class CashController {
    private cashService: CashService;

    constructor(cashService: CashService) {
        this.cashService = cashService;
    }

    // Usamos arrow functions para no perder el 'this'
    getSummary = async (req: Request, res: Response) => {
        try {
            const summary = await this.cashService.getDailySummary();
            res.json(summary);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener caja' });
        }
    }

    createMovement = async (req: Request, res: Response) => {
        try {
            const { amount, description, type, method } = req.body;

            const numericAmount = parseFloat(amount);

            if (isNaN(numericAmount)) {
                return res.status(400).json({ error: "El monto debe ser un número válido" });
            }

            // 👇 2. ARMAMOS EL OBJETO LIMPIO
            const cleanData = {
                amount: numericAmount, 
                description: description,
                type: type,   // 'INCOME' o 'EXPENSE'
                method: method, // 'CASH' o 'TRANSFER'
                date: new Date() // Aseguramos que tenga fecha
            };

            const movement = await this.cashService.addMovement(cleanData);
            res.json(movement);

        } catch (error) {
            console.error("❌ Error en createMovement:", error); 
            res.status(500).json({ error: 'Error al crear movimiento' });
        }
    }
}