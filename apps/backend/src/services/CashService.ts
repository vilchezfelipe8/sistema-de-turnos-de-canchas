import { CashRepository } from '../repositories/CashRepository';

export class CashService {
    constructor(private cashRepository: CashRepository) {}

    async getDailySummary() {
        // 1. Definir rango de HOY
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        // 2. Pedir datos al repo
        const movements = await this.cashRepository.findAllByDateRange(start, end);

        // 3. Calcular totales (Lógica de negocio)
        let totalCash = 0;
        let totalDigital = 0;
        let totalIncome = 0;
        let totalExpense = 0;

        movements.forEach(m => {
            const val = m.type === 'INCOME' ? m.amount : -m.amount;
            
            if (m.type === 'INCOME') totalIncome += m.amount;
            else totalExpense += m.amount;

            if (m.method === 'CASH') totalCash += val;
            else totalDigital += val;
        });

        return {
            balance: {
                total: totalCash + totalDigital,
                cash: totalCash,
                digital: totalDigital,
                income: totalIncome,
                expense: totalExpense
            },
            movements
        };
    }

    async addMovement(data: any) {
        return this.cashRepository.create(data);
    }
}