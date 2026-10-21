import { describe, expect, it } from 'vitest';
import {
  durationMinutes,
  formatDuration,
  formatTime,
  hoursToMinutes,
  movementsOverlap,
  parseTime,
} from './time';

describe('time', () => {
  it('convierte horas y minutos', () => {
    expect(parseTime('09:30')).toBe(570);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('24:00')).toBeNull();
    expect(formatTime(570)).toBe('09:30');
    expect(formatTime(1440)).toBe('00:00');
  });

  it('formatea duraciones', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(480)).toBe('8h');
    expect(formatDuration(465)).toBe('7h 45m');
    expect(formatDuration(-90)).toBe('−1h 30m');
  });

  it('calcula tramos con pausa y cambio de día', () => {
    expect(
      durationMinutes({
        startMin: 540,
        endMin: 1020,
        breakMin: 30,
        crossesMidnight: 0,
      }),
    ).toBe(450);
    expect(
      durationMinutes({
        startMin: 1320,
        endMin: 360,
        breakMin: 30,
        crossesMidnight: 1,
      }),
    ).toBe(450);
  });

  it('detecta solapamientos', () => {
    const base = { breakMin: 0, crossesMidnight: 0 as const };
    expect(
      movementsOverlap(
        { ...base, startMin: 540, endMin: 780 },
        { ...base, startMin: 600, endMin: 900 },
      ),
    ).toBe(true);
    expect(
      movementsOverlap(
        { ...base, startMin: 540, endMin: 780 },
        { ...base, startMin: 780, endMin: 900 },
      ),
    ).toBe(false);
  });

  it('interpreta horas decimales para ajustes', () => {
    expect(hoursToMinutes('8')).toBe(480);
    expect(hoursToMinutes('7,5')).toBe(450);
    expect(hoursToMinutes('abc')).toBeNull();
  });
});
