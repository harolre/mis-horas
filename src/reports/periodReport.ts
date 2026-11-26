import type {
  Account,
  DayEntry,
  DayKind,
  ISODate,
  Movement,
  Settings,
} from '../types';
import {
  attachmentCountsRange,
  getSettings,
  listAccounts,
  listDaysRange,
  listMovementsRange,
} from '../db/repos';
import {
  addDays,
  eachDay,
  endOfMonth,
  endOfYear,
  formatMonth,
  formatMonthYear,
  formatWeekTitle,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from '../domain/date';
import { durationMinutes } from '../domain/time';
import { periodTotals } from '../domain/totals';

export type ReportPeriod = 'week' | 'month' | 'year';

export interface ReportMovement {
  startMin: number;
  endMin: number;
  breakMin: number;
  category: 'work' | 'medical';
  accountName: string;
  minutes: number;
}

export interface ReportDay {
  date: ISODate;
  kind: DayKind;
  kindLabel: string;
  movements: ReportMovement[];
  total: number;
  attachmentCount: number;
}

export interface ReportMonth {
  month: ISODate;
  label: string;
  worked: number;
  target: number;
  extra: number;
  vacation: number;
  personal: number;
  sick: number;
  holiday: number;
  medicalMinutes: number;
  attachmentCount: number;
}

export interface ReportAccountTotal {
  name: string;
  color: string;
  minutes: number;
}

export interface PeriodReport {
  period: ReportPeriod;
  from: ISODate;
  to: ISODate;
  title: string;
  subtitle: string;
  worked: number;
  target: number;
  extra: number;
  daysWithHours: number;
  days: ReportDay[];
  absences: Record<Exclude<DayKind, 'work'>, number>;
  medicalMinutes: number;
  attachmentCount: number;
  attachmentDays: number;
  accounts: ReportAccountTotal[];
  months: ReportMonth[];
}

const KIND_LABELS: Record<DayKind, string> = {
  work: 'Trabajo',
  vacation: 'Vacaciones',
  personal: 'Asunto propio',
  holiday: 'Festivo',
  sick: 'Baja',
};

function emptyAbsences(): Record<Exclude<DayKind, 'work'>, number> {
  return { vacation: 0, personal: 0, sick: 0, holiday: 0 };
}

function countAbsences(days: DayEntry[]): Record<Exclude<DayKind, 'work'>, number> {
  const result = emptyAbsences();
  for (const day of days) {
    if (day.kind !== 'work') result[day.kind] += 1;
  }
  return result;
}

function medicalMinutesFor(movements: Movement[]): number {
  return movements
    .filter((movement) => movement.category === 'medical')
    .reduce((total, movement) => total + durationMinutes(movement), 0);
}

function attachmentTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function attachmentDayTotal(counts: Record<string, number>): number {
  return Object.values(counts).filter((count) => count > 0).length;
}

function buildDays(
  from: ISODate,
  to: ISODate,
  movements: Movement[],
  dayEntries: DayEntry[],
  accounts: Account[],
  attachmentCounts: Record<string, number>,
): ReportDay[] {
  const accountNames = new Map(
    accounts.map((account) => [account.id, account.name]),
  );
  const dayMap = new Map(dayEntries.map((day) => [day.date, day]));
  const result: ReportDay[] = [];

  for (const date of eachDay(from, to)) {
    const entry = dayMap.get(date);
    const kind = entry?.kind ?? 'work';
    const dayMovements = movements
      .filter((movement) => movement.date === date)
      .sort((a, b) => a.startMin - b.startMin)
      .map<ReportMovement>((movement) => ({
        startMin: movement.startMin,
        endMin: movement.endMin,
        breakMin: movement.breakMin,
        category: movement.category === 'medical' ? 'medical' : 'work',
        accountName: accountNames.get(movement.accountId) ?? 'Cuenta eliminada',
        minutes: durationMinutes(movement),
      }));
    result.push({
      date,
      kind,
      kindLabel: KIND_LABELS[kind],
      movements: dayMovements,
      total: dayMovements.reduce((total, movement) => total + movement.minutes, 0),
      attachmentCount: attachmentCounts[date] ?? 0,
    });
  }
  return result;
}

function buildMonths(
  year: number,
  movements: Movement[],
  dayEntries: DayEntry[],
  settings: Settings,
  attachmentCounts: Record<string, number>,
): ReportMonth[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}-01`;
    const from = startOfMonth(month);
    const to = endOfMonth(month);
    const monthMovements = movements.filter(
      (movement) => movement.date >= from && movement.date <= to,
    );
    const monthDays = dayEntries.filter(
      (day) => day.date >= from && day.date <= to,
    );
    const totals = periodTotals(
      from,
      to,
      monthMovements,
      settings,
      true,
      monthDays,
      'period',
    );
    const absences = countAbsences(monthDays);
    return {
      month,
      label: formatMonth(month),
      worked: totals.worked,
      target: totals.target,
      extra: totals.extra,
      vacation: absences.vacation,
      personal: absences.personal,
      sick: absences.sick,
      holiday: absences.holiday,
      medicalMinutes: medicalMinutesFor(monthMovements),
      attachmentCount: attachmentTotal(
        Object.fromEntries(
          Object.entries(attachmentCounts).filter(
            ([date]) => date >= from && date <= to,
          ),
        ),
      ),
    };
  });
}

export async function buildPeriodReport(
  period: ReportPeriod,
  anchor: ISODate,
): Promise<PeriodReport> {
  const settings = await getSettings();
  const from: ISODate =
    period === 'week'
      ? startOfWeek(anchor, settings.weekStart)
      : period === 'month'
        ? startOfMonth(anchor)
        : startOfYear(anchor);
  const to: ISODate =
    period === 'week'
      ? addDays(from, 6)
      : period === 'month'
        ? endOfMonth(anchor)
        : endOfYear(anchor);

  const [movements, dayEntries, accounts, attachmentCounts] =
    await Promise.all([
      listMovementsRange(from, to),
      listDaysRange(from, to),
      listAccounts(true),
      attachmentCountsRange(from, to),
    ]);

  const absences = countAbsences(dayEntries);
  const medicalMinutes = medicalMinutesFor(movements);
  const attachmentCount = attachmentTotal(attachmentCounts);
  const attachmentDays = attachmentDayTotal(attachmentCounts);
  const accountMinutes = new Map<string, number>();
  for (const movement of movements) {
    accountMinutes.set(
      movement.accountId,
      (accountMinutes.get(movement.accountId) ?? 0) + durationMinutes(movement),
    );
  }
  const accountTotals = accounts
    .map((account) => ({
      name: account.name,
      color: account.color,
      minutes: accountMinutes.get(account.id) ?? 0,
    }))
    .filter((account) => account.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const year = parseISO(anchor).getFullYear();
  const months =
    period === 'year'
      ? buildMonths(year, movements, dayEntries, settings, attachmentCounts)
      : [];
  const totals =
    period === 'year'
      ? {
          worked: months.reduce((total, month) => total + month.worked, 0),
          target: months.reduce((total, month) => total + month.target, 0),
          extra: months.reduce((total, month) => total + month.extra, 0),
        }
      : periodTotals(
          from,
          to,
          movements,
          settings,
          true,
          dayEntries,
          period === 'month' ? 'period' : 'weekly',
        );

  const days =
    period === 'year'
      ? []
      : buildDays(
          from,
          to,
          movements,
          dayEntries,
          accounts,
          attachmentCounts,
        ).filter(
          (day) =>
            period === 'week' ||
            day.movements.length > 0 ||
            day.kind !== 'work' ||
            day.attachmentCount > 0,
        );
  const daysWithHours = new Set(movements.map((movement) => movement.date)).size;

  const title =
    period === 'week'
      ? `Semana del ${formatWeekTitle(from, to)}`
      : period === 'month'
        ? formatMonthYear(anchor)
        : `Año ${year}`;

  return {
    period,
    from,
    to,
    title,
    subtitle:
      period === 'week'
        ? 'Informe semanal de horas'
        : period === 'month'
          ? 'Informe mensual de horas'
          : 'Resumen anual de horas',
    worked: totals.worked,
    target: totals.target,
    extra: totals.extra,
    daysWithHours,
    days,
    absences,
    medicalMinutes,
    attachmentCount,
    attachmentDays,
    accounts: accountTotals,
    months,
  };
}
