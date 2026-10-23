import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayKind } from '../../types';
import {
  getSettings,
  listAccounts,
  listDaysRange,
  listMovementsRange,
} from '../../db/repos';
import {
  addDays,
  formatShortDate,
  formatWeekdayLong,
  formatWeekTitle,
  startOfWeek,
  todayISO,
} from '../../domain/date';
import { formatCompactDuration, formatDuration } from '../../domain/time';
import { daysOfWeek, weekTotals } from '../../domain/totals';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../components/Icon';
import { ProgressBar } from '../../components/ProgressBar';
import { DayEditorSheet } from './DayEditorSheet';
import { MovementTemplatesSection } from './MovementTemplatesSection';
import { kindInfo } from './dayKinds';

interface TodayScreenProps {
  date: string;
  onDateChange: (date: string) => void;
  onOpenSummary: () => void;
}

interface WeekDayRow {
  date: string;
  worked: number;
  target: number;
  excess: number;
  kind: DayKind;
  attachmentCount: number;
}

export function TodayScreen({
  date,
  onDateChange,
  onOpenSummary,
}: TodayScreenProps) {
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const weekStart = startOfWeek(date, settings?.weekStart ?? 1);
  const weekEnd = addDays(weekStart, 6);

  const movements = useLiveQuery(
    () => listMovementsRange(weekStart, weekEnd),
    [weekStart, weekEnd],
  );
  const days = useLiveQuery(
    () => listDaysRange(weekStart, weekEnd),
    [weekStart, weekEnd],
  );
  const accounts = useLiveQuery(() => listAccounts(true), []);

  const dayEntries = new Map((days ?? []).map((entry) => [entry.date, entry]));
  const baseRows =
    settings && movements && days
      ? daysOfWeek(weekStart, movements, settings)
      : Array.from({ length: 7 }, (_, index) => ({
          date: addDays(weekStart, index),
          worked: 0,
          target: 0,
        }));
  const rows: WeekDayRow[] = baseRows.map((row) => {
    const entry = dayEntries.get(row.date);
    return {
      ...row,
      excess: row.target > 0 ? Math.max(0, row.worked - row.target) : 0,
      kind: entry?.kind ?? 'work',
      attachmentCount: entry?.attachmentCount ?? 0,
    };
  });

  const week =
    settings && movements ? weekTotals(weekStart, movements, settings) : null;
  const daysWithHours = rows.filter((row) => row.worked > 0).length;
  const activeAccounts = (accounts ?? []).filter((account) => !account.archived);
  const today = todayISO();
  const isToday = date === today;
  const editingRow = rows.find((row) => row.date === editingDate);
  const dataReady = Boolean(settings && movements && days && accounts);

  function shiftWeek(amount: number) {
    onDateChange(addDays(date, amount * 7));
  }

  function openDatePicker() {
    const input = dateInputRef.current;
    if (!input) return;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    try {
      if (typeof picker.showPicker === 'function') picker.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  }

  return (
    <div className="screen">
      <input
        ref={dateInputRef}
        type="date"
        className="date-input-hidden"
        value={date}
        tabIndex={-1}
        aria-label="Seleccionar fecha"
        onChange={(event) => {
          if (event.target.value) onDateChange(event.target.value);
        }}
      />

      <ScreenHeader
        title="Inicio"
        subtitle={formatWeekTitle(weekStart, weekEnd)}
        actions={
          <>
            {!isToday ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onDateChange(today)}
              >
                Hoy
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button"
              onClick={() => shiftWeek(-1)}
              aria-label="Semana anterior"
            >
              <Icon name="chevron-left" size={19} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={openDatePicker}
              aria-label="Elegir fecha"
            >
              <Icon name="calendar" size={19} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => shiftWeek(1)}
              aria-label="Semana siguiente"
            >
              <Icon name="chevron-right" size={19} />
            </button>
          </>
        }
      />

      <section className="hero home-hero" aria-label="Resumen de la semana">
        <div className="row-between">
          <span className="hero-label">Total de la semana</span>
          <button
            type="button"
            className="hero-pill hero-pill-action"
            onClick={onOpenSummary}
            aria-label="Ver resumen de la semana"
          >
            <Icon name="chart" size={13} />
            Resumen
          </button>
        </div>
        <div className="hero-value">{week ? formatDuration(week.worked) : '—'}</div>
        <div className="hero-meta">
          <span>
            {daysWithHours === 0
              ? 'Sin horas registradas'
              : `${daysWithHours} ${
                  daysWithHours === 1 ? 'día' : 'días'
                } con horas`}
          </span>
          {week ? (
            week.target > 0 ? (
              <>
                <span>Objetivo {formatDuration(week.target)}</span>
                <span>
                  {week.extra > 0
                    ? `Extra semanal +${formatDuration(week.extra)}`
                    : week.diff < 0
                      ? `Faltan ${formatDuration(-week.diff)}`
                      : 'Objetivo semanal cumplido'}
                </span>
              </>
            ) : (
              <span>
                {week.extra > 0
                  ? `Extra semanal +${formatDuration(week.extra)}`
                  : 'Sin objetivo semanal'}
              </span>
            )
          ) : null}
        </div>
        <div className="hero-footer">
          <ProgressBar
            value={week && week.target > 0 ? week.worked / week.target : 0}
          />
        </div>
      </section>

      {accounts !== undefined && activeAccounts.length === 0 ? (
        <div className="banner warning">
          <Icon name="alert" size={16} />
          <span>
            No hay cuentas activas. Crea una o desarchiva alguna desde la
            pestaña Cuentas.
          </span>
        </div>
      ) : null}

      <section className="card week-card" aria-label="Días de la semana">
        {rows.map((row) => {
          const rowInfo = kindInfo(row.kind);
          const rowIsToday = row.date === today;
          return (
            <div
              className={`week-day ${rowIsToday ? 'today' : ''}`}
              key={row.date}
            >
              <button
                type="button"
                className="week-day-summary"
                onClick={() => setEditingDate(row.date)}
                aria-haspopup="dialog"
                disabled={!dataReady}
              >
                <span className="week-day-main">
                  <span className="week-day-name">
                    {formatWeekdayLong(row.date)}
                  </span>
                  <span className="week-day-meta">
                    <span className="week-day-date">
                      {formatShortDate(row.date)}
                    </span>
                    {rowIsToday ? (
                      <span className="badge primary">Hoy</span>
                    ) : null}
                    {row.kind !== 'work' ? (
                      <span className={`badge ${rowInfo.chipClass}`}>
                        {rowInfo.label}
                      </span>
                    ) : null}
                    {row.attachmentCount > 0 ? (
                      <span className="week-day-attach">
                        <Icon name="paperclip" size={12} />
                        {row.attachmentCount}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="week-day-hours">
                  <strong>
                    {row.worked > 0 ? formatCompactDuration(row.worked) : '—'}
                  </strong>
                  <span>
                    {row.target > 0
                      ? `de ${formatCompactDuration(row.target)}`
                      : 'sin objetivo'}
                  </span>
                  {row.excess > 0 ? (
                    <span
                      className="week-day-excess"
                      title="Exceso sobre el objetivo del día"
                    >
                      +{formatCompactDuration(row.excess)}
                    </span>
                  ) : null}
                </span>
                <Icon
                  name="chevron-right"
                  size={16}
                  className="week-day-chevron"
                />
              </button>
            </div>
          );
        })}
      </section>

      <MovementTemplatesSection accounts={accounts ?? []} />

      {editingDate ? (
        <DayEditorSheet
          key={editingDate}
          date={editingDate}
          target={editingRow?.target ?? 0}
          accounts={accounts ?? []}
          initialDay={dayEntries.get(editingDate)}
          initialMovements={(movements ?? []).filter(
            (movement) => movement.date === editingDate,
          )}
          onClose={() => setEditingDate(null)}
        />
      ) : null}
    </div>
  );
}
