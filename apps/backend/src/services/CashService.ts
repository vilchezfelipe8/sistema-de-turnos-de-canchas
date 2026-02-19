import { CashRepository } from '../repositories/CashRepository';
import { TimeHelper } from '../utils/TimeHelper';

export class CashService {
    constructor(private cashRepository: CashRepository) {}

    async getDailySummary(clubId?: number) {
        const { startUtc: start, endUtc: end } = TimeHelper.getUtcRangeForLocalDate(new Date());

        // 2. Pedir datos al repo
    const movements = await this.cashRepository.findAllByDateRange(start, end, clubId);

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