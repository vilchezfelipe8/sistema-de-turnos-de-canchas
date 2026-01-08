import { CourtRepository } from '../repositories/CourtRepository';
// Si tienes tipos definidos para la cancha, impórtalos aquí (ej: CreateCourtDto)

export class CourtService {
    private courtRepository: CourtRepository;

    constructor() {
        this.courtRepository = new CourtRepository();
    }


    async deleteCourt(id: number) {
        // Aquí se llama a la función que hicimos en el paso anterior
        return await this.courtRepository.deleteCourt(id);
    }
}