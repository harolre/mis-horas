import { describe, expect, it } from 'vitest';
import {
  addDays,
  eachDay,
  isValidISODate,
  monthMatrix,
  startOfWeek,
  weekday,
} from './date';

describe('date', () => {
  it('valida fechas ISO reales', () => {
    expect(isValidISODate('2026-10-21')).toBe(true);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('21/10/2026')).toBe(false);
  });

  it('calcula el día de la semana con lunes = 1', () => {
    expect(weekday('2026-10-19')).toBe(1);
    expect(weekday('2026-10-25')).toBe(7);
  });

  it('calcula el inicio de semana configurable', () => {
    expect(startOfWeek('2026-10-21', 1)).toBe('2026-10-19');
    expect(startOfWeek('2026-10-21', 7)).toBe('2026-10-18');
  });

  it('recorre rangos y genera calendarios', () => {
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    const cells = monthMatrix('2026-10-01', 1);
    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe('2026-09-28');
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it('suma días cruzando meses', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
