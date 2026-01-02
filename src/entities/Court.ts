import { Club } from './Club';
import { ActivityType } from './ActivityType';

export class Court {
    public supportedActivities: ActivityType[] = [];

    constructor(
        public id: number,
        public name: string,
        public isIndoor: boolean,
        public surface: string,
        public club: Club, // Referencia al padre
        public isUnderMaintenance: boolean = false
    ) {}

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            isIndoor: this.isIndoor,
            surface: this.surface,
            isUnderMaintenance: this.isUnderMaintenance,
            supportedActivities: this.supportedActivities,
            // ACÁ ESTÁ EL TRUCO:
            // En vez de devolver todo el objeto 'club' (que causa el bucle),
            // devolvemos solo el nombre o el ID. Rompemos el círculo.
            club: this.club ? { id: this.club.id, name: this.club.name } : null
        };
    }
}   