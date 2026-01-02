export class TimeHelper {
    // Convierte "14:30" a minutos totales desde las 00:00 (ej: 870)
    static timeToMinutes(time: string): number {
        const [hours, minutes] = time.split(':').map(Number);
        return (hours * 60) + minutes;
    }

    // Convierte 870 a "14:30"
    static minutesToTime(minutes: number): string {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        // Agrega un '0' adelante si es menor a 10 (ej: 09:05)
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    // Suma minutos a una hora: "14:00" + 90 = "15:30"
    static addMinutes(time: string, minutesToAdd: number): string {
        const totalMinutes = this.timeToMinutes(time) + minutesToAdd;
        return this.minutesToTime(totalMinutes);
    }

    // Verifica si dos rangos se superponen (Overlap)
    // Rango A: [startA, endA] vs Rango B: [startB, endB]
    static isOverlapping(startA: string, endA: string, startB: string, endB: string): boolean {
        const sA = this.timeToMinutes(startA);
        const eA = this.timeToMinutes(endA);
        const sB = this.timeToMinutes(startB);
        const eB = this.timeToMinutes(endB);

        // La lógica de colisión: (StartA < EndB) y (EndA > StartB)
        return sA < eB && eA > sB;
    }
}