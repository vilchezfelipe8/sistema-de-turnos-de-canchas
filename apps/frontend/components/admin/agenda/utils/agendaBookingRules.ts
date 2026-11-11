import { slotMinutes, startHour, totalSlots } from './agendaDateUtils';

/** Reglas de reserva del día, tal como las devuelve GET /clubs/:slug/admin/booking-rules. */
export type AgendaBookingFormatRule = {
  id: string;
  name: string;
  durationMinutes: number | null;
  shortGapMinutes: number | null;
  playerCount?: number | null;
};

export type AgendaActivityBookingRules = {
  activityId: number;
  isClosed: boolean;
  mode: 'FIXED' | 'RANGE';
  durations: number[];
  formats: AgendaBookingFormatRule[];
  slots: Array<{ start: string; durationMinutes: number }>;
  // Turnos de esta noche que empiezan pasada la medianoche ("00:30" = 24:30).
  overnightSlots?: Array<{ start: string; durationMinutes: number }>;
};

export type AgendaBookingRules = {
  date: string;
  timeZone: string;
  professorOverrideMinutes: number | null;
  activities: AgendaActivityBookingRules[];
};

/** Turno válido expresado en slots de la grilla: [startSlot, endSlot). */
export type AgendaRuleSlot = { startSlot: number; endSlot: number; durationMinutes: number };

const timeToMinutes = (value: string) => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;
  return hours * 60 + minutes;
};

/** Pasa los turnos válidos a slots de la grilla. Descarta lo que no cae en la grilla de 15 min. */
export function toRuleSlots(rule: AgendaActivityBookingRules | null | undefined): AgendaRuleSlot[] {
  if (!rule || rule.isClosed) return [];
  const result: AgendaRuleSlot[] = [];
  const all = [
    ...rule.slots.map((slot) => ({ ...slot, extra: 0 })),
    ...(rule.overnightSlots || []).map((slot) => ({ ...slot, extra: 24 * 60 })),
  ];
  for (const slot of all) {
    const offset = timeToMinutes(slot.start) + slot.extra - startHour * 60;
    if (!Number.isFinite(offset) || offset < 0 || offset % slotMinutes !== 0) continue;
    if (slot.durationMinutes % slotMinutes !== 0) continue;
    const startSlot = offset / slotMinutes;
    const endSlot = startSlot + slot.durationMinutes / slotMinutes;
    if (endSlot > totalSlots) continue;
    result.push({ startSlot, endSlot, durationMinutes: slot.durationMinutes });
  }
  return result;
}

const formatDurations = (format: AgendaBookingFormatRule) =>
  [format.durationMinutes, format.shortGapMinutes].filter((value): value is number => Number(value) > 0);

/**
 * Duraciones que se pueden elegir.
 * - Modalidad elegida con duración fija: esa (y la corta si el club la permite).
 * - Actividad con modalidades (precio por jugador) y ninguna elegida: las de sus modalidades.
 * - Sin modalidades: las del club.
 */
export function allowedDurationsFor(
  rule: AgendaActivityBookingRules | null | undefined,
  activityFormatId?: string | null
): number[] {
  if (!rule) return [];
  const format = activityFormatId ? rule.formats.find((item) => item.id === activityFormatId) : null;
  const sortUnique = (values: number[]) => Array.from(new Set(values)).sort((a, b) => a - b);
  const clubDurations = rule.durations.length > 0 ? rule.durations : rule.slots.map((slot) => slot.durationMinutes);
  // Modalidad sin duración fija: valen las duraciones del club.
  const durationsOf = (item: AgendaBookingFormatRule) =>
    Number(item.durationMinutes) > 0 ? formatDurations(item) : clubDurations;
  if (format) return sortUnique(durationsOf(format));
  if (rule.formats.length > 0) return sortUnique(rule.formats.flatMap(durationsOf));
  if (rule.durations.length > 0) return sortUnique(rule.durations);
  return sortUnique(rule.slots.map((slot) => slot.durationMinutes));
}

/** Duración que se propone con un clic: la de la primera modalidad, o la primera del club. */
export function defaultDurationFor(rule: AgendaActivityBookingRules | null | undefined): number | null {
  if (!rule) return null;
  return rule.formats[0]?.durationMinutes ?? rule.durations[0] ?? null;
}

/** Slots de inicio válidos para una duración dada. */
export function startSlotsForDuration(ruleSlots: AgendaRuleSlot[], durationMinutes: number): number[] {
  return ruleSlots
    .filter((slot) => slot.durationMinutes === durationMinutes)
    .map((slot) => slot.startSlot)
    .sort((a, b) => a - b);
}

/** Marca por slot de la grilla si cae dentro de algún turno válido (para grisar el resto). */
export function bookableSlotMask(ruleSlots: AgendaRuleSlot[]): boolean[] {
  const mask = Array.from({ length: totalSlots }, () => false);
  for (const slot of ruleSlots) {
    for (let index = slot.startSlot; index < slot.endSlot && index < totalSlots; index += 1) {
      mask[index] = true;
    }
  }
  return mask;
}

export function isValidRulePlacement(
  ruleSlots: AgendaRuleSlot[],
  startSlot: number,
  endSlot: number
): boolean {
  return ruleSlots.some((slot) => slot.startSlot === startSlot && slot.endSlot === endSlot);
}

/**
 * Ajusta una selección arrastrada (desde `anchorSlot` hasta `pointerSlot`) a un turno que el club acepta.
 * - El inicio queda fijo en el turno válido donde se apretó.
 * - El fin salta a la próxima duración permitida que cubre el puntero (30 → 60 → 90...), con tope en la máxima.
 * - Arrastrando hacia arriba es al revés: el fin queda fijo y el inicio sube por pasos.
 * `isFree` descarta turnos que chocan con otras reservas.
 */
export function snapCreateSelection(options: {
  ruleSlots: AgendaRuleSlot[];
  durations: number[];
  anchorSlot: number;
  pointerSlot: number;
  isFree: (startSlot: number, endSlot: number) => boolean;
}): AgendaRuleSlot | null {
  const { ruleSlots, durations, anchorSlot, pointerSlot, isFree } = options;
  const candidates = ruleSlots.filter(
    (slot) => durations.includes(slot.durationMinutes) && isFree(slot.startSlot, slot.endSlot)
  );
  // Turnos que contienen el punto donde se apretó.
  const containing = candidates.filter((slot) => slot.startSlot <= anchorSlot && anchorSlot < slot.endSlot);
  if (containing.length === 0) return null;

  if (pointerSlot >= anchorSlot) {
    // Inicio: el turno válido que arranca más cerca (antes o en) el punto apretado.
    const startSlot = Math.max(...containing.map((slot) => slot.startSlot));
    const choices = containing
      .filter((slot) => slot.startSlot === startSlot)
      .sort((a, b) => a.endSlot - b.endSlot);
    const target = pointerSlot + 1;
    return choices.find((slot) => slot.endSlot >= target) ?? choices[choices.length - 1];
  }

  // Hacia arriba: fin fijo en el turno más corto que arranca en el punto (o lo contiene), inicio por pasos.
  const endSlot = Math.min(...containing.map((slot) => slot.endSlot));
  const choices = candidates
    .filter((slot) => slot.endSlot === endSlot)
    .sort((a, b) => b.startSlot - a.startSlot);
  return choices.find((slot) => slot.startSlot <= pointerSlot) ?? choices[choices.length - 1] ?? null;
}

/** Para mover: el inicio válido más cercano al deseado, con la misma duración. */
export function snapMoveStart(options: {
  ruleSlots: AgendaRuleSlot[];
  durationMinutes: number;
  desiredStartSlot: number;
  isFree: (startSlot: number, endSlot: number) => boolean;
}): AgendaRuleSlot | null {
  const { ruleSlots, durationMinutes, desiredStartSlot, isFree } = options;
  let best: AgendaRuleSlot | null = null;
  for (const slot of ruleSlots) {
    if (slot.durationMinutes !== durationMinutes) continue;
    if (!isFree(slot.startSlot, slot.endSlot)) continue;
    if (!best || Math.abs(slot.startSlot - desiredStartSlot) < Math.abs(best.startSlot - desiredStartSlot)) {
      best = slot;
    }
  }
  return best;
}

export function formatDurationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest}`;
}
