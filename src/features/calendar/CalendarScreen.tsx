import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayEntry, Movement } from '../../types';
import { getSettings, listDaysRange, listMovementsRange } from '../../db/repos';
import {
  addMonths,
  addDays,
  endOfMonth,
  formatDayNumber,
  formatMonthYear,
  formatShortDate,
  formatWeekday,
  monthMatrix,
  startOfMonth,
  startOfWeek,
  todayISO,
} from '../../domain/date';
import {
  formatCompactDuration,
  formatDuration,
} from '../../domain/time';
import { periodTotals, targetForDate } from '../../domain/totals';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../components/Icon';

interface CalendarScreenProps {
  onSelectDate: (date: string) => void;
}

const KIND_SHORT: Record<string, string> = {
  vacation: 'Vac',
  holiday: 'Fest',
  sick: 'Baja',
};

const KIND_LABEL: Record<string, string> = {
  vacation: 'vacaciones',
  holiday: 'festivo',
  sick: 'baja',
};

export function CalendarScreen({ onSelectDate }: CalendarScreenProps) {
  const [anchor, setAnchor] = useState(todayISO());
  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const weekStartDay = settings?.weekStart ?? 1;
  const cells = monthMatrix(anchor, weekStartDay);
  const gridStart = cells[0].date;
  const gridEnd = cells[cells.length - 1].date;
  const monthFrom = startOfMonth(anchor);
  const monthTo = endOfMonth(anchor);

  const movements = useLiveQuery(
    () => listMovementsRange(gridStart, gridEnd),
    [gridStart, gridEnd],
    [] as Movement[],
  );
  const days = useLiveQuery(
    () => listDaysRange(gridStart, gridEnd),
    [gridStart, gridEnd],
    [] as DayEntry[],
  );

  const workedByDate = new Map<string, number>();
  for (const movement of movements) {
    const minutes =
      movement.endMin -
      movement.startMin +
      (movement.crossesMidnight ? 1440 : 0) -
      movement.breakMin;
    workedByDate.set(
      movement.date,
      (workedByDate.get(movement.date) ?? 0) + minutes,
    );
  }
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const monthTotals = settings
    ? periodTotals(monthFrom, monthTo, movements, settings, false)
    : null;

  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    formatWeekday(addDays(startOfWeek(monthFrom, weekStartDay), index)),
  );

  function cellClass(date: string, inMonth: boolean): string {
    const day = dayByDate.get(date);
    const worked = workedByDate.get(date) ?? 0;
    const target = settings ? targetForDate(date, settings) : 0;
    let className = 'calendar-cell';
    if (!inMonth) className += ' outside';
    if (day?.kind === 'vacation') className += ' vacation';
    else if (day?.kind === 'holiday') className += ' holiday';
    else if (day?.kind === 'sick') className += ' sick';
    else if (worked > 0) {
      if (target > 0 && worked > target) className += ' extra';
      else if (target > 0 && worked >= target) className += ' complete';
      else className += ' has-hours';
    }
    if (date === todayISO()) className += ' today';
    return className;
  }

  function cellText(date: string): string {
    const day = dayByDate.get(date);
    if (day && day.kind !== 'work') return KIND_SHORT[day.kind] ?? '';
    const worked = workedByDate.get(date) ?? 0;
    return worked > 0 ? formatCompactDuration(worked) : '';
  }

  function cellAria(date: string, inMonth: boolean): string {
    const day = dayByDate.get(date);
    const worked = workedByDate.get(date) ?? 0;
    const parts = [formatShortDate(date)];
    if (!inMonth) parts.push('fuera del mes');
    if (day && day.kind !== 'work') parts.push(KIND_LABEL[day.kind] ?? day.kind);
    if (worked > 0) parts.push(formatDuration(worked));
    if (day?.attachmentCount) {
      parts.push(
        `${day.attachmentCount} adjunto${day.attachmentCount === 1 ? '' : 's'}`,
      );
    }
    return parts.join(', ');
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="Calendario"
        subtitle="Toca un día para verlo o registrar horas"
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAnchor(todayISO())}
          >
            Hoy
          </button>
        }
      />

      <section className="card calendar-card">
        <div className="row-between" style={{ padding: '2px 2px 12px' }}>
          <button
            type="button"
            className="icon-button plain"
            onClick={() => setAnchor(addMonths(anchor, -1))}
            aria-label="Mes anterior"
          >
            <Icon name="chevron-left" size={19} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="period-title">{formatMonthYear(anchor)}</div>
            <div className="period-subtitle">
              {monthTotals
                ? `${formatDuration(monthTotals.worked)} de ${formatDuration(
                    monthTotals.target,
                  )}`
                : 'Cargando…'}
            </div>
          </div>
          <button
            type="button"
            className="icon-button plain"
            onClick={() => setAnchor(addMonths(anchor, 1))}
            aria-label="Mes siguiente"
          >
            <Icon name="chevron-right" size={19} />
          </button>
        </div>

        <div className="calendar-weekdays" aria-hidden="true">
          {weekdayLabels.map((label) => (
            <div className="calendar-weekday" key={label}>
              {label}
            </div>
          ))}
        </div>

        <div className="calendar-grid">
          {cells.map((cell) => {
            const worked = workedByDate.get(cell.date) ?? 0;
            const day = dayByDate.get(cell.date);
            return (
              <button
                key={cell.date}
                type="button"
                className={cellClass(cell.date, cell.inMonth)}
                onClick={() => onSelectDate(cell.date)}
                aria-label={cellAria(cell.date, cell.inMonth)}
              >
                {day?.attachmentCount ? (
                  <span className="calendar-clip" aria-hidden="true">
                    <Icon name="paperclip" size={10} strokeWidth={2} />
                  </span>
                ) : null}
                <span className="calendar-day-number">
                  {formatDayNumber(cell.date)}
                </span>
                {cellText(cell.date) ? (
                  <span className="calendar-hours">{cellText(cell.date)}</span>
                ) : worked === 0 ? (
                  <span className="calendar-dot" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="calendar-legend">
          <span className="legend-item">
            <span
              className="legend-dot"
              style={{ background: 'var(--primary-soft)' }}
            />
            Con horas
          </span>
          <span className="legend-item">
            <span
              className="legend-dot"
              style={{ background: 'var(--success)' }}
            />
            Objetivo
          </span>
          <span className="legend-item">
            <span
              className="legend-dot"
              style={{ background: 'var(--warning)' }}
            />
            Extra
          </span>
          <span className="legend-item">
            <span
              className="legend-dot"
              style={{ background: 'var(--vacation)' }}
            />
            Vacaciones
          </span>
          <span className="legend-item">
            <span
              className="legend-dot"
              style={{ background: 'var(--holiday)' }}
            />
            Festivo
          </span>
          <span className="legend-item">
            <span
              className="legend-dot"
              style={{ background: 'var(--sick)' }}
            />
            Baja
          </span>
          <span className="legend-item">
            <Icon name="paperclip" size={11} />
            Adjuntos
          </span>
        </div>
      </section>

      <div className="banner">
        <Icon name="info" size={16} />
        <span>
          Las vacaciones, festivos y bajas no alteran los totales de horas; solo
          sirven como información del día.
        </span>
      </div>
    </div>
  );
}
