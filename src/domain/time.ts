import type { Movement } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

export function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTime(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

export function formatDuration(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? '−' : '';
  const absolute = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  if (hours === 0) return `${sign}${minutes}m`;
  if (minutes === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h ${pad(minutes)}m`;
}

export function formatCompactDuration(totalMinutes: number): string {
  const absolute = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}:${pad(minutes)}`;
}

export function formatHoursDecimal(totalMinutes: number): string {
  return (totalMinutes / 60).toFixed(2).replace(/\.00$/, '');
}

export function hoursToMinutes(value: string): number | null {
  const normalized = value.replace(',', '.').trim();
  if (normalized === '') return null;
  const hours = Number(normalized);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return null;
  return Math.round(hours * 60);
}

export function minutesToHoursInput(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0$/, '');
}

type DurationSource = Pick<
  Movement,
  'startMin' | 'endMin' | 'breakMin' | 'crossesMidnight'
>;

export function durationMinutes(movement: DurationSource): number {
  const overnight = movement.crossesMidnight ? 1440 : 0;
  return movement.endMin - movement.startMin + overnight - movement.breakMin;
}

export function movementInterval(movement: DurationSource): [number, number] {
  const start = movement.startMin;
  const end = movement.endMin + (movement.crossesMidnight ? 1440 : 0);
  return [start, end];
}

export function movementsOverlap(
  a: DurationSource,
  b: DurationSource,
): boolean {
  const [aStart, aEnd] = movementInterval(a);
  const [bStart, bEnd] = movementInterval(b);
  return aStart < bEnd && bStart < aEnd;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)} %`;
}
