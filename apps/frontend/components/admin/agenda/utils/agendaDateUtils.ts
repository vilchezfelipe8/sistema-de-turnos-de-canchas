import type { DraftSelection } from '../types/agendaTypes';

export const rowHeight = 120;
export const startHour = 8;
export const endHour = 23;
export const slotMinutes = 15;
export const slotsPerHour = 60 / slotMinutes;
export const totalSlots = (endHour - startHour) * slotsPerHour;
export const slotHeight = rowHeight / slotsPerHour;
export const gridHeight = totalSlots * slotHeight;

export function slotToTime(slot: number) {
  const totalMinutes = startHour * 60 + slot * slotMinutes;
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
  const total = hours * 60 + minutes;
  const start = startHour * 60;
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
