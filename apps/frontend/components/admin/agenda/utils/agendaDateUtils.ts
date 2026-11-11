import type { DraftSelection } from '../types/agendaTypes';

export const rowHeight = 120;
export const slotMinutes = 15;
export const slotsPerHour = 60 / slotMinutes;
export const slotHeight = rowHeight / slotsPerHour;

export const DEFAULT_AGENDA_START_HOUR = 8;
export const DEFAULT_AGENDA_END_HOUR = 23;
// La grilla puede pasar la medianoche (club que cierra a la 01:00): la noche es del día que se mira.
export const MAX_AGENDA_END_HOUR = 30;

// Rango de horas de la grilla. Son `let` exportados (live bindings): la página de agenda
// los ajusta al horario del club con configureAgendaHours() ANTES de montar la grilla,
// y la vuelve a montar si cambian. No cambiarlos con la grilla montada.
export let startHour = DEFAULT_AGENDA_START_HOUR;
export let endHour = DEFAULT_AGENDA_END_HOUR;
export let totalSlots = (endHour - startHour) * slotsPerHour;
export let gridHeight = totalSlots * slotHeight;

export function configureAgendaHours(nextStartHour: number, nextEndHour: number) {
  const start = Math.max(0, Math.min(23, Math.floor(nextStartHour)));
  const end = Math.max(start + 1, Math.min(MAX_AGENDA_END_HOUR, Math.ceil(nextEndHour)));
  startHour = start;
  endHour = end;
  totalSlots = (endHour - startHour) * slotsPerHour;
  gridHeight = totalSlots * slotHeight;
}

/** Minutos desde la medianoche del día de la grilla; pasada la medianoche sigue contando (24:30 = 1470). */
export function minutesFromDayStart(date: Date, day: Date) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  return Math.round((date.getTime() - dayStart.getTime()) / 60000);
}

/** Hora del slot sin dar la vuelta: "24:30" para la media hora después de la medianoche. */
export function slotToDayTime(slot: number) {
  const totalMinutes = startHour * 60 + slot * slotMinutes;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

export function slotToTime(slot: number) {
  const totalMinutes = (startHour * 60 + slot * slotMinutes) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function slotToTimeAmPm(slot: number) {
  const [hoursRaw, minutesRaw] = slotToTime(slot).split(':').map(Number);
  const hours = Number.isFinite(hoursRaw) ? hoursRaw : 0;
  const minutes = Number.isFinite(minutesRaw) ? minutesRaw : 0;
  const period = hours >= 12 ? 'p. m.' : 'a. m.';
  const hours12 = ((hours + 11) % 12) + 1;
  return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function timeToSlot(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  let total = hours * 60 + minutes;
  const start = startHour * 60;
  // "00:30" en una grilla que pasa la medianoche es la madrugada de esta noche.
  if (total < start && endHour > 24) total += 24 * 60;
  return Math.max(0, Math.min(totalSlots, Math.round((total - start) / slotMinutes)));
}

export function buildSelectionDateTime(baseDate: Date, slot: number) {
  const next = new Date(baseDate);
  next.setHours(0, 0, 0, 0);
  const totalMinutes = startHour * 60 + slot * slotMinutes;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  next.setHours(hours, minutes, 0, 0);
  return next;
}

export function minutesToHourLabel(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(safeMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (safeMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function toSelectionRange(selection: DraftSelection) {
  return {
    start: Math.min(selection.startSlot, selection.endSlot),
    end: Math.max(selection.startSlot, selection.endSlot) + 1,
  };
}

export function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextDateForDay(baseDate: Date, targetDayIndex: number, timeStr: string) {
  const resultDate = new Date(baseDate);
  const currentDay = resultDate.getDay();
  let daysUntilTarget = targetDayIndex - currentDay;
  if (daysUntilTarget < 0) daysUntilTarget += 7;
  resultDate.setDate(resultDate.getDate() + daysUntilTarget);
  const [hours, minutes] = timeStr.split(':').map(Number);
  resultDate.setHours(hours, minutes, 0, 0);
  const now = new Date();
  if (daysUntilTarget === 0 && resultDate.getTime() <= now.getTime()) {
    resultDate.setDate(resultDate.getDate() + 7);
  }
  return resultDate;
}

export function buildStartDateTimeFromSlot(baseDate: Date, slot: number) {
  const startDateTime = new Date(baseDate);
  startDateTime.setHours(0, 0, 0, 0);
  const totalMinutes = startHour * 60 + slot * slotMinutes;
  startDateTime.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
  return startDateTime;
}
