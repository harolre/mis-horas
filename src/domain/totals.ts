import type { ISODate, Movement, Settings } from '../types';
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
}

export interface MonthSummary {
  month: ISODate;
  worked: number;
  target: number;
}

export function targetForDate(date: ISODate, settings: Settings): number {
  const override = settings.dateOverrides[date];
  if (typeof override === 'number') return override;
  return settings.dailyTargets[weekday(date) - 1] ?? 0;
}

export function sumTarget(from: ISODate, to: ISODate, settings: Settings): number {
  let total = 0;
  let cursor = from;
  while (cursor <= to) {
    total += targetForDate(cursor, settings);
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
): WeekSummary {
  const start = weekStartFor(date, settings);
  const end = addDays(start, 6);
  const worked = sumWorked(movements.filter((m) => inRange(m, start, end)));
  const target = sumTarget(start, end, settings);
  return {
    start,
    end,
    worked,
    target,
    diff: worked - target,
    extra: Math.max(0, worked - target),
  };
}

export function periodTotals(
  from: ISODate,
  to: ISODate,
  movements: Movement[],
  settings: Settings,
  includeExtra = true,
): PeriodTotals {
  const inPeriod = movements.filter((m) => inRange(m, from, to));
  const worked = sumWorked(inPeriod);
  const target = sumTarget(from, to, settings);
  const perAccount: Record<string, number> = {};
  for (const movement of inPeriod) {
    perAccount[movement.accountId] =
      (perAccount[movement.accountId] ?? 0) + durationMinutes(movement);
  }

  let extra = 0;
  if (includeExtra) {
    let week = startOfWeek(from, settings.weekStart);
    while (week <= to) {
      if (week >= from) {
        const end = addDays(week, 6);
        const weekWorked = sumWorked(
          movements.filter((m) => inRange(m, week, end)),
        );
        const weekTarget = sumTarget(week, end, settings);
        extra += Math.max(0, weekWorked - weekTarget);
      }
      week = addDays(week, 7);
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
): WeekSummary[] {
  const weeks: WeekSummary[] = [];
  let cursor = startOfWeek(from, settings.weekStart);
  while (cursor <= to) {
    if (cursor >= from) {
      weeks.push(weekTotals(cursor, movements, settings));
    }
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function daysOfWeek(
  start: ISODate,
  movements: Movement[],
  settings: Settings,
): Array<{ date: ISODate; worked: number; target: number }> {
  const result = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(start, index);
    result.push({
      date,
      worked: sumWorked(movements.filter((m) => m.date === date)),
      target: targetForDate(date, settings),
    });
  }
  return result;
}

export function monthlyBreakdown(
  year: ISODate,
  movements: Movement[],
  settings: Settings,
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
      target: sumTarget(from, to, settings),
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
