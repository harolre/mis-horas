import { describe, expect, it } from 'vitest';
import type { DayEntry, Movement, Settings } from '../types';
import {
  daysOfWeek,
  monthlyBreakdown,
  periodTotals,
  sumTarget,
  targetForDate,
  weekTotals,
  weeklyBreakdown,
} from './totals';

const settings: Settings = {
  id: 'app',
  weekStart: 1,
  dailyTargets: [480, 480, 480, 480, 480, 0, 0],
  dateOverrides: {},
  updatedAt: 0,
};

let counter = 0;
function movement(date: string, hours: number, accountId = 'a1'): Movement {
  counter += 1;
  return {
    id: `m${counter}`,
    accountId,
    date,
    startMin: 540,
    endMin: 540 + hours * 60,
    breakMin: 0,
    crossesMidnight: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('totals', () => {
  it('aplica objetivos por día y excepciones', () => {
    expect(targetForDate('2026-10-19', settings)).toBe(480);
    expect(targetForDate('2026-10-25', settings)).toBe(0);
    expect(
      targetForDate('2026-10-21', {
        ...settings,
        dateOverrides: { '2026-10-21': 240 },
      }),
    ).toBe(240);
    expect(sumTarget('2026-10-19', '2026-10-25', settings)).toBe(2400);
  });

  it('calcula totales semanales y extras', () => {
    const movements = [
      movement('2026-10-19', 8),
      movement('2026-10-20', 8),
      movement('2026-10-21', 8),
      movement('2026-10-22', 8),
      movement('2026-10-23', 8),
    ];
    const week = weekTotals('2026-10-21', movements, settings);
    expect(week.worked).toBe(2400);
    expect(week.target).toBe(2400);
    expect(week.extra).toBe(0);

    const withExtra = weekTotals(
      '2026-10-21',
      [...movements, movement('2026-10-23', 2)],
      settings,
    );
    expect(withExtra.worked).toBe(2520);
    expect(withExtra.extra).toBe(120);
  });

  it('reduce el objetivo por vacaciones, bajas y festivos sin sumarlas como trabajadas', () => {
    const days: DayEntry[] = [
      { date: '2026-10-19', kind: 'vacation', updatedAt: 0 },
      { date: '2026-10-20', kind: 'sick', updatedAt: 0 },
      { date: '2026-10-21', kind: 'holiday', updatedAt: 0 },
    ];
    const movements = [
      movement('2026-10-22', 8),
      movement('2026-10-23', 10),
    ];

    const week = weekTotals('2026-10-21', movements, settings, days);

    expect(week.worked).toBe(1080);
    expect(week.target).toBe(960);
    expect(week.extra).toBe(120);
    expect(week.excused).toEqual({ vacation: 480, sick: 480, holiday: 480 });
    expect(sumTarget('2026-10-19', '2026-10-25', settings, days)).toBe(960);

    const month = periodTotals(
      '2026-10-01',
      '2026-10-31',
      movements,
      settings,
      true,
      days,
      'period',
    );
    expect(month.worked).toBe(1080);
    expect(month.target).toBe(9120);
    expect(month.extra).toBe(0);

    const monthBar = monthlyBreakdown('2026-10-01', movements, settings, days)[9];
    expect(monthBar.month).toBe('2026-10-01');
    expect(monthBar.target).toBe(9120);
    expect(monthBar.excused).toEqual({ vacation: 480, sick: 480, holiday: 480 });
  });

  it('agrupa por cuenta y suma extras de semanas del periodo', () => {
    const movements = [
      movement('2026-10-01', 8, 'a1'),
      movement('2026-10-02', 8, 'a1'),
      movement('2026-10-02', 2, 'a1'),
      movement('2026-10-05', 10, 'a2'),
      movement('2026-10-06', 8, 'a2'),
      movement('2026-10-07', 8, 'a2'),
      movement('2026-10-08', 8, 'a2'),
      movement('2026-10-09', 8, 'a2'),
    ];
    const totals = periodTotals('2026-10-01', '2026-10-31', movements, settings);
    expect(totals.worked).toBe(3600);
    expect(totals.perAccount.a1).toBe(1080);
    expect(totals.perAccount.a2).toBe(2520);
    // Se incluyen los días del 1-2 de octubre de la semana parcial,
    // además de las extras de la semana completa que empieza el 5.
    expect(totals.extra).toBe(240);
  });

  it('desglosa semanas y meses', () => {
    const movements = [
      movement('2026-10-01', 8),
      movement('2026-10-02', 8),
      movement('2026-10-19', 8),
      movement('2026-11-02', 6),
    ];
    const weeks = weeklyBreakdown('2026-10-01', '2026-11-30', movements, settings);
    expect(weeks.length).toBeGreaterThanOrEqual(8);
    expect(weeks[0].start).toBe('2026-10-01');
    expect(weeks[0].end).toBe('2026-10-04');
    expect(weeks[0].target).toBe(960);
    expect(weeks[0].worked).toBe(960);
    expect(weeks[0].extra).toBe(0);
    const months = monthlyBreakdown('2026-10-01', movements, settings);
    expect(months).toHaveLength(12);
    expect(months[9].worked).toBe(1440);
    expect(months[10].worked).toBe(360);
  });

  it('genera los siete días de una semana', () => {
    const days = daysOfWeek(
      '2026-10-19',
      [movement('2026-10-19', 4)],
      settings,
    );
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({
      date: '2026-10-19',
      worked: 240,
      target: 480,
      kind: 'work',
      excused: 0,
    });
    expect(days[6]).toEqual({
      date: '2026-10-25',
      worked: 0,
      target: 0,
      kind: 'work',
      excused: 0,
    });
  });
});
