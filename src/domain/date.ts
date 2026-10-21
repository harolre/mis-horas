import type { ISODate, Weekday } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(date: Date): ISODate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISO(value: ISODate): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseISO(value);
  return !Number.isNaN(parsed.getTime()) && toISO(parsed) === value;
}

export function todayISO(): ISODate {
  return toISO(new Date());
}

export function addDays(value: ISODate, amount: number): ISODate {
  const date = parseISO(value);
  date.setDate(date.getDate() + amount);
  return toISO(date);
}

/** Lunes = 1, domingo = 7. */
export function weekday(value: ISODate): Weekday {
  const day = parseISO(value).getDay();
  return (day === 0 ? 7 : day) as Weekday;
}

export function startOfWeek(value: ISODate, weekStart: Weekday): ISODate {
  const difference = (weekday(value) - weekStart + 7) % 7;
  return addDays(value, -difference);
}

export function endOfWeek(value: ISODate, weekStart: Weekday): ISODate {
  return addDays(startOfWeek(value, weekStart), 6);
}

export function startOfMonth(value: ISODate): ISODate {
  const date = parseISO(value);
  return toISO(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function endOfMonth(value: ISODate): ISODate {
  const date = parseISO(value);
  return toISO(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function startOfYear(value: ISODate): ISODate {
  const date = parseISO(value);
  return toISO(new Date(date.getFullYear(), 0, 1));
}

export function endOfYear(value: ISODate): ISODate {
  const date = parseISO(value);
  return toISO(new Date(date.getFullYear(), 11, 31));
}

export function addMonths(value: ISODate, amount: number): ISODate {
  const date = parseISO(value);
  return toISO(new Date(date.getFullYear(), date.getMonth() + amount, 1));
}

export function addYears(value: ISODate, amount: number): ISODate {
  const date = parseISO(value);
  return toISO(new Date(date.getFullYear() + amount, date.getMonth(), 1));
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const days: ISODate[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export interface MonthCell {
  date: ISODate;
  inMonth: boolean;
}

export function monthMatrix(anchor: ISODate, weekStart: Weekday): MonthCell[] {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first, weekStart);
  const month = parseISO(first).getMonth();
  const cells: MonthCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    cells.push({ date, inMonth: parseISO(date).getMonth() === month });
  }
  return cells;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const longDateFormatter = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const shortDateFormatter = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
});

const weekdayFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'short' });

const monthFormatter = new Intl.DateTimeFormat('es-ES', {
  month: 'long',
  year: 'numeric',
});

const monthOnlyFormatter = new Intl.DateTimeFormat('es-ES', { month: 'long' });

const dayNumberFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric' });

export function formatLongDate(value: ISODate): string {
  return capitalize(longDateFormatter.format(parseISO(value)));
}

export function formatShortDate(value: ISODate): string {
  return shortDateFormatter.format(parseISO(value));
}

export function formatWeekday(value: ISODate): string {
  return capitalize(weekdayFormatter.format(parseISO(value)).replace('.', ''));
}

export function formatMonthYear(value: ISODate): string {
  return capitalize(monthFormatter.format(parseISO(value)));
}

export function formatMonth(value: ISODate): string {
  return capitalize(monthOnlyFormatter.format(parseISO(value)));
}

export function formatDayNumber(value: ISODate): string {
  return dayNumberFormatter.format(parseISO(value));
}

export function formatWeekTitle(from: ISODate, to: ISODate): string {
  const fromDate = parseISO(from);
  const toDate = parseISO(to);
  if (fromDate.getFullYear() !== toDate.getFullYear()) {
    return `${formatShortDate(from)} ${fromDate.getFullYear()} – ${formatShortDate(to)} ${toDate.getFullYear()}`;
  }
  if (fromDate.getMonth() !== toDate.getMonth()) {
    return `${formatShortDate(from)} – ${formatShortDate(to)} ${toDate.getFullYear()}`;
  }
  return `${formatDayNumber(from)} – ${formatDayNumber(to)} de ${formatMonth(to)} ${toDate.getFullYear()}`;
}
