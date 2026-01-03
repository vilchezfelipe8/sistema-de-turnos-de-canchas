import { Club } from './Club';
import { ActivityType } from './ActivityType';

export class Court {
    public supportedActivities: ActivityType[] = [];

    constructor(
        public id: number,
        public name: string,
        public isIndoor: boolean,
        public surface: string,
        public club: Club,
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
            club: this.club ? { id: this.club.id, name: this.club.name } : null
        };
    }
}

