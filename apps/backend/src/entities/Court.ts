import { Club } from './Club';
import { ActivityType } from './ActivityType';

export class Court {
    constructor(
        public id: number,
        public name: string,
        public isIndoor: boolean,
        public surface: string,
        public club: Club,
        public isUnderMaintenance: boolean = false,
        public activityType?: ActivityType | null
    ) {}

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            isIndoor: this.isIndoor,
            surface: this.surface,
            isUnderMaintenance: this.isUnderMaintenance,
            activityType: this.activityType ? { id: this.activityType.id, name: this.activityType.name } : null,
            club: this.club ? { id: this.club.id, name: this.club.name } : null
        };
    }
}

