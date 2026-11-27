import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Account, DayEntry, DayKind, Movement } from '../../types';
import {
  getSettings,
  listAccounts,
  listDaysRange,
  listMovementsRange,
} from '../../db/repos';
import {
  addDays,
  addMonths,
  endOfMonth,
  formatDayNumber,
  formatLongDate,
  formatMonthYear,
  formatShortDate,
  formatWeekday,
  monthMatrix,
  startOfMonth,
  startOfWeek,
  todayISO,
} from '../../domain/date';
import {
  durationMinutes,
  formatCompactDuration,
  formatDuration,
  formatTime,
} from '../../domain/time';
import { periodTotals, targetForDate } from '../../domain/totals';
import { ABSENCE_KINDS, dayKindInfo } from '../../domain/dayKinds';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../components/Icon';
import { ProgressBar } from '../../components/ProgressBar';
import { PeriodNavigator } from '../../components/PeriodNavigator';
import { DayEditorSheet } from '../today/DayEditorSheet';
import { ExportPdfModal } from '../summary/ExportPdfModal';

interface CalendarScreenProps {
  onSelectDate: (date: string) => void;
  onOpenSummary: (date: string) => void;
}

export function CalendarScreen({
  onSelectDate,
  onOpenSummary,
}: CalendarScreenProps) {
  const [anchor, setAnchor] = useState(todayISO());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const dayCardRef = useRef<HTMLElement | null>(null);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const accounts = useLiveQuery(
    () => listAccounts(true),
    [],
    [] as Account[],
  );
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

  useEffect(() => {
    if (
      selectedDate &&
      (selectedDate < monthFrom || selectedDate > monthTo)
    ) {
      setSelectedDate(null);
    }
  }, [monthFrom, monthTo, selectedDate]);

  useEffect(() => {
    if (!selectedDate) return undefined;
    const timer = window.setTimeout(() => {
      dayCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [selectedDate]);

  const workedByDate = new Map<string, number>();
  for (const movement of movements) {
    const minutes = durationMinutes(movement);
    workedByDate.set(
      movement.date,
      (workedByDate.get(movement.date) ?? 0) + minutes,
    );
  }
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const monthTotals = settings
    ? periodTotals(monthFrom, monthTo, movements, settings, true, days, 'period')
    : null;
  const monthMovements = movements.filter(
    (movement) => movement.date >= monthFrom && movement.date <= monthTo,
  );
  const monthDaysWithHours = new Set(
    monthMovements.map((movement) => movement.date),
  ).size;
  const monthAbsences: Record<Exclude<DayKind, 'work'>, number> = {
    vacation: 0,
    personal: 0,
    sick: 0,
    holiday: 0,
  };
  for (const day of days) {
    if (day.date < monthFrom || day.date > monthTo || day.kind === 'work') {
      continue;
    }
    monthAbsences[day.kind] += 1;
  }
  const monthMedicalMinutes = monthMovements
    .filter((movement) => movement.category === 'medical')
    .reduce((total, movement) => total + durationMinutes(movement), 0);

  const selectedDay = selectedDate
    ? dayByDate.get(selectedDate)
    : undefined;
  const selectedMovements = selectedDate
    ? movements
        .filter((movement) => movement.date === selectedDate)
        .sort((a, b) => a.startMin - b.startMin)
    : [];
  const selectedWorked = selectedDate
    ? workedByDate.get(selectedDate) ?? 0
    : 0;
  const selectedTarget =
    selectedDate && settings
      ? targetForDate(selectedDate, settings, days)
      : 0;
  const selectedKind = selectedDay?.kind ?? 'work';
  const selectedKindInfo = dayKindInfo(selectedKind);
  const selectedKindLabel = selectedKindInfo.label;
  const editingTarget =
    editingDate && settings
      ? targetForDate(editingDate, settings, days)
      : 0;

  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    formatWeekday(addDays(startOfWeek(monthFrom, weekStartDay), index)),
  );

  function cellClass(date: string, inMonth: boolean): string {
    const day = dayByDate.get(date);
    const worked = workedByDate.get(date) ?? 0;
    const target = settings ? targetForDate(date, settings, days) : 0;
    let className = 'calendar-cell';
    if (!inMonth) className += ' outside';
    if (day?.kind === 'vacation') className += ' vacation';
    else if (day?.kind === 'personal') className += ' personal';
    else if (day?.kind === 'holiday') className += ' holiday';
    else if (day?.kind === 'sick') className += ' sick';
    else if (worked > 0) {
      if (target > 0 && worked > target) className += ' extra';
      else if (target > 0 && worked >= target) className += ' complete';
      else className += ' has-hours';
    }
    if (date === todayISO()) className += ' today';
    if (date === selectedDate) className += ' selected';
    return className;
  }

  function cellText(date: string): string {
    const day = dayByDate.get(date);
    if (day && day.kind !== 'work') return dayKindInfo(day.kind).shortLabel;
    const worked = workedByDate.get(date) ?? 0;
    return worked > 0 ? formatCompactDuration(worked) : '';
  }

  function cellAria(date: string, inMonth: boolean): string {
    const day = dayByDate.get(date);
    const worked = workedByDate.get(date) ?? 0;
    const parts = [formatShortDate(date)];
    if (!inMonth) parts.push('fuera del mes');
    if (day && day.kind !== 'work') {
      parts.push(dayKindInfo(day.kind).label.toLowerCase());
    }
    if (worked > 0) parts.push(formatDuration(worked));
    if (day?.attachmentCount) {
      parts.push(
        `${day.attachmentCount} adjunto${day.attachmentCount === 1 ? '' : 's'}`,
      );
    }
    return parts.join(', ');
  }

  function selectDay(date: string, inMonth: boolean) {
    if (!inMonth) return;
    setSelectedDate(date);
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="Calendario"
        subtitle="Resumen, días y edición"
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setExportOpen(true)}
            >
              <Icon name="download" size={15} />
              PDF
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setAnchor(todayISO())}
            >
              Hoy
            </button>
          </>
        }
      />

      <section className="card card-pad calendar-month-summary">
        <PeriodNavigator
          title={formatMonthYear(anchor)}
          subtitle={`${monthDaysWithHours} ${
            monthDaysWithHours === 1 ? 'día' : 'días'
          } con horas`}
          onPrevious={() => setAnchor(addMonths(anchor, -1))}
          onNext={() => setAnchor(addMonths(anchor, 1))}
          previousLabel="Mes anterior"
          nextLabel="Mes siguiente"
        />

        {monthTotals ? (
          <>
            <div className="calendar-summary-grid">
              <div>
                <span>Trabajadas</span>
                <strong>{formatDuration(monthTotals.worked)}</strong>
              </div>
              <div>
                <span>Objetivo</span>
                <strong>{formatDuration(monthTotals.target)}</strong>
              </div>
              <div>
                <span>Extra</span>
                <strong>
                  {monthTotals.extra > 0
                    ? `+${formatDuration(monthTotals.extra)}`
                    : '—'}
                </strong>
              </div>
            </div>
            <ProgressBar
              value={
                monthTotals.target > 0
                  ? monthTotals.worked / monthTotals.target
                  : 0
              }
            />
            <div className="calendar-summary-tags">
              {ABSENCE_KINDS.filter(
                (item) => monthAbsences[item.value] > 0,
              ).map((item) => {
                const count = monthAbsences[item.value];
                return (
                  <span className="calendar-summary-tag" key={item.value}>
                    <i className={`absence-dot ${item.chipClass}`} />
                    {count}{' '}
                    {(count === 1 ? item.label : item.pluralLabel).toLowerCase()}
                  </span>
                );
              })}
              {monthMedicalMinutes > 0 ? (
                <span className="calendar-summary-tag">
                  <i className="absence-dot medical" />
                  {formatDuration(monthMedicalMinutes)} de médico
                </span>
              ) : null}
              {monthAbsences.vacation === 0 &&
              monthAbsences.personal === 0 &&
              monthAbsences.sick === 0 &&
              monthAbsences.holiday === 0 &&
              monthMedicalMinutes === 0 ? (
                <span className="calendar-summary-tag muted">
                  Sin ausencias ni tiempo de médico
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm calendar-summary-link"
              onClick={() => onOpenSummary(monthFrom)}
            >
              Ver resumen del mes
              <Icon name="chevron-right" size={15} />
            </button>
          </>
        ) : (
          <div className="row-center">
            <span className="spinner" />
            <span className="small muted">Cargando mes…</span>
          </div>
        )}
      </section>

      <section className="card calendar-card">
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
                onClick={() => selectDay(cell.date, cell.inMonth)}
                aria-label={cellAria(cell.date, cell.inMonth)}
                aria-pressed={cell.date === selectedDate}
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
          {ABSENCE_KINDS.map((item) => (
            <span className="legend-item" key={item.value}>
              <span
                className="legend-dot"
                style={{ background: `var(${item.colorVar})` }}
              />
              {item.label}
            </span>
          ))}
          <span className="legend-item">
            <Icon name="paperclip" size={11} />
            Adjuntos
          </span>
        </div>
      </section>

      {selectedDate ? (
        <section
          className="card calendar-day-card"
          ref={dayCardRef}
        >
          <div className="card-header">
            <div>
              <div className="card-title">
                {formatLongDate(selectedDate)}
              </div>
              <div className="card-subtitle">
                {selectedKindLabel} · {formatDuration(selectedWorked)}
                {selectedTarget > 0
                  ? ` de ${formatDuration(selectedTarget)}`
                  : ''}
              </div>
            </div>
            <button
              type="button"
              className="icon-button plain"
              onClick={() => setSelectedDate(null)}
              aria-label="Cerrar resumen del día"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="calendar-day-body">
            {selectedMovements.length > 0 ? (
              <div className="calendar-movement-list">
                {selectedMovements.map((movement) => (
                  <div className="calendar-movement" key={movement.id}>
                    <i
                      className={`calendar-movement-dot ${
                        movement.category === 'medical'
                          ? 'medical'
                          : 'work'
                      }`}
                    />
                    <span className="calendar-movement-time">
                      {formatTime(movement.startMin)}–
                      {formatTime(movement.endMin)}
                    </span>
                    <span className="calendar-movement-account">
                      {movement.category === 'medical' ? 'Médico' : 'Trabajo'}
                      {accountMap.get(movement.accountId)
                        ? ` · ${accountMap.get(movement.accountId)?.name}`
                        : ''}
                    </span>
                    <strong className="calendar-movement-total">
                      {formatDuration(durationMinutes(movement))}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-text calendar-day-empty">
                {selectedKind === 'work'
                  ? 'Sin horas registradas.'
                  : `Día de ${selectedKindLabel.toLowerCase()}.`}
              </p>
            )}

            {selectedDay?.attachmentCount ? (
              <div className="calendar-day-attach">
                <Icon name="paperclip" size={14} />
                {selectedDay.attachmentCount}{' '}
                {selectedDay.attachmentCount === 1 ? 'adjunto' : 'adjuntos'}
              </div>
            ) : null}

            <div className="calendar-day-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setEditingDate(selectedDate)}
              >
                <Icon name="edit" size={16} />
                Editar día
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onSelectDate(selectedDate)}
              >
                Ir a Inicio
              </button>
            </div>
          </div>
        </section>
      ) : (
        <p className="field-hint calendar-hint">
          Toca un día para ver su resumen y editarlo.
        </p>
      )}

      {editingDate ? (
        <DayEditorSheet
          key={editingDate}
          date={editingDate}
          target={editingTarget}
          accounts={accounts}
          initialDay={dayByDate.get(editingDate)}
          initialMovements={movements.filter(
            (movement) => movement.date === editingDate,
          )}
          onClose={() => setEditingDate(null)}
        />
      ) : null}

      {exportOpen ? (
        <ExportPdfModal
          initialPeriod="month"
          initialAnchor={anchor}
          onClose={() => setExportOpen(false)}
        />
      ) : null}
    </div>
  );
}
