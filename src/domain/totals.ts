import type { DayEntry, DayKind, ISODate, Movement, Settings } from '../types';
import {
  addDays,
  endOfMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
  weekday,
} from './date';
import { durationMinutes } from './time';

export interface Totals {
  worked: number;
  target: number;
  diff: number;
  extra: number;
}

export interface PeriodTotals extends Totals {
  perAccount: Record<string, number>;
}

export interface WeekSummary extends Totals {
  start: ISODate;
  end: ISODate;
  excused: Record<Exclude<DayKind, 'work'>, number>;
}

export interface MonthSummary {
  month: ISODate;
  worked: number;
  target: number;
  excused: Record<Exclude<DayKind, 'work'>, number>;
}

export type ExcusedHours = Record<Exclude<DayKind, 'work'>, number>;
export type ExtraCalculation = 'weekly' | 'period';

function emptyExcusedHours(): ExcusedHours {
  return { vacation: 0, holiday: 0, sick: 0 };
}

function dayForDate(date: ISODate, days: readonly DayEntry[]): DayEntry | undefined {
  return days.find((day) => day.date === date);
}

export function scheduledTargetForDate(date: ISODate, settings: Settings): number {
  const override = settings.dateOverrides[date];
  if (typeof override === 'number') return override;
  return settings.dailyTargets[weekday(date) - 1] ?? 0;
}

export function targetForDate(
  date: ISODate,
  settings: Settings,
  days: readonly DayEntry[] = [],
): number {
  const day = dayForDate(date, days);
  return day && day.kind !== 'work' ? 0 : scheduledTargetForDate(date, settings);
}

function excusedHoursForRange(
  from: ISODate,
  to: ISODate,
  settings: Settings,
  days: readonly DayEntry[],
): ExcusedHours {
  const result = emptyExcusedHours();
  let cursor = from;
  while (cursor <= to) {
    const day = dayForDate(cursor, days);
    if (day && day.kind !== 'work') {
      result[day.kind] += scheduledTargetForDate(cursor, settings);
    }
    cursor = addDays(cursor, 1);
  }
  return result;
}

export function sumTarget(
  from: ISODate,
  to: ISODate,
  settings: Settings,
  days: readonly DayEntry[] = [],
): number {
  let total = 0;
  let cursor = from;
  while (cursor <= to) {
    total += targetForDate(cursor, settings, days);
    cursor = addDays(cursor, 1);
  }
  return total;
}

export function sumWorked(movements: Movement[]): number {
  return movements.reduce((total, movement) => total + durationMinutes(movement), 0);
}

export function inRange(movement: Movement, from: ISODate, to: ISODate): boolean {
  return movement.date >= from && movement.date <= to;
}

export function weekStartFor(date: ISODate, settings: Settings): ISODate {
  return startOfWeek(date, settings.weekStart);
}

export function weekTotals(
  date: ISODate,
  movements: Movement[],
  settings: Settings,
  days: readonly DayEntry[] = [],
): WeekSummary {
  const start = weekStartFor(date, settings);
  const end = addDays(start, 6);
  const worked = sumWorked(movements.filter((m) => inRange(m, start, end)));
  const target = sumTarget(start, end, settings, days);
  return {
    start,
    end,
    worked,
    target,
    diff: worked - target,
    extra: Math.max(0, worked - target),
    excused: excusedHoursForRange(start, end, settings, days),
  };
}

export function periodTotals(
  from: ISODate,
  to: ISODate,
  movements: Movement[],
  settings: Settings,
  includeExtra = true,
  days: readonly DayEntry[] = [],
  extraCalculation: ExtraCalculation = 'weekly',
): PeriodTotals {
  const inPeriod = movements.filter((m) => inRange(m, from, to));
  const worked = sumWorked(inPeriod);
  const target = sumTarget(from, to, settings, days);
  const perAccount: Record<string, number> = {};
  for (const movement of inPeriod) {
    perAccount[movement.accountId] =
      (perAccount[movement.accountId] ?? 0) + durationMinutes(movement);
  }

  let extra = 0;
  if (includeExtra) {
    if (extraCalculation === 'period') {
      extra = Math.max(0, worked - target);
    } else {
      let week = startOfWeek(from, settings.weekStart);
      while (week <= to) {
        const sliceFrom = week < from ? from : week;
        const weekEnd = addDays(week, 6);
        const sliceTo = weekEnd > to ? to : weekEnd;
        const sliceWorked = sumWorked(
          movements.filter((m) => inRange(m, sliceFrom, sliceTo)),
        );
        const sliceTarget = sumTarget(sliceFrom, sliceTo, settings, days);
        extra += Math.max(0, sliceWorked - sliceTarget);
        week = addDays(week, 7);
      }
    }
  }

  return {
    worked,
    target,
    diff: worked - target,
    extra,
    perAccount,
  };
}

export function weeklyBreakdown(
  from: ISODate,
  to: ISODate,
  movements: Movement[],
  settings: Settings,
  days: readonly DayEntry[] = [],
): WeekSummary[] {
  const weeks: WeekSummary[] = [];
  let cursor = startOfWeek(from, settings.weekStart);
  while (cursor <= to) {
    const sliceFrom = cursor < from ? from : cursor;
    const weekEnd = addDays(cursor, 6);
    const sliceTo = weekEnd > to ? to : weekEnd;
    const worked = sumWorked(
      movements.filter((movement) => inRange(movement, sliceFrom, sliceTo)),
    );
    const target = sumTarget(sliceFrom, sliceTo, settings, days);
    weeks.push({
      start: sliceFrom,
      end: sliceTo,
      worked,
      target,
      diff: worked - target,
      extra: Math.max(0, worked - target),
      excused: excusedHoursForRange(sliceFrom, sliceTo, settings, days),
    });
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function daysOfWeek(
  start: ISODate,
  movements: Movement[],
  settings: Settings,
  days: readonly DayEntry[] = [],
): Array<{
  date: ISODate;
  worked: number;
  target: number;
  kind: DayKind;
  excused: number;
}> {
  const result = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(start, index);
    const entry = dayForDate(date, days);
    result.push({
      date,
      worked: sumWorked(movements.filter((m) => m.date === date)),
      target: targetForDate(date, settings, days),
      kind: entry?.kind ?? 'work',
      excused:
        entry && entry.kind !== 'work'
          ? scheduledTargetForDate(date, settings)
          : 0,
    });
  }
  return result;
}

export function monthlyBreakdown(
  year: ISODate,
  movements: Movement[],
  settings: Settings,
  days: readonly DayEntry[] = [],
): MonthSummary[] {
  const months: MonthSummary[] = [];
  const yearStart = startOfYear(year);
  for (let index = 0; index < 12; index += 1) {
    const monthDate = `${parseISO(yearStart).getFullYear()}-${String(index + 1).padStart(2, '0')}-01`;
    const from = startOfMonth(monthDate);
    const to = endOfMonth(monthDate);
    months.push({
      month: monthDate,
      worked: sumWorked(movements.filter((m) => inRange(m, from, to))),
      target: sumTarget(from, to, settings, days),
      excused: excusedHoursForRange(from, to, settings, days),
    });
  }
  return months;
}

export function weekExtraForWeeksStartingIn(
  from: ISODate,
  to: ISODate,
  movements: Movement[],
  settings: Settings,
): number {
  return weeklyBreakdown(from, to, movements, settings).reduce(
    (total, week) => total + week.extra,
    0,
  );
}
