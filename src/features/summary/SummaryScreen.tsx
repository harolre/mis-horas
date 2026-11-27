import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DayEntry, DayKind, ISODate, Movement } from '../../types';
import {
  getSettings,
  listDaysRange,
  listMovementsRange,
} from '../../db/repos';
import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  endOfYear,
  formatMonth,
  formatMonthYear,
  formatShortDate,
  formatWeekday,
  formatWeekRangeShort,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
  todayISO,
} from '../../domain/date';
import {
  durationMinutes,
  formatCompactDuration,
  formatDuration,
} from '../../domain/time';
import {
  daysOfWeek,
  monthlyBreakdown,
  periodTotals,
  weeklyBreakdown,
} from '../../domain/totals';
import { ABSENCE_KINDS, dayKindInfo } from '../../domain/dayKinds';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../components/Icon';
import { ProgressBar } from '../../components/ProgressBar';
import { Segmented } from '../../components/Segmented';
import { PeriodNavigator } from '../../components/PeriodNavigator';
import { ExportPdfModal } from './ExportPdfModal';

type Period = 'week' | 'month' | 'year';

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
];

function formatDayCount(count: number): string {
  return `${count} ${count === 1 ? 'día' : 'días'}`;
}

interface SummaryScreenProps {
  initialDate: string;
  initialPeriod?: Period;
}

export function SummaryScreen({
  initialDate,
  initialPeriod = 'week',
}: SummaryScreenProps) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [anchor, setAnchor] = useState(initialDate || todayISO());
  const [exportOpen, setExportOpen] = useState(false);

  const settings = useLiveQuery(() => getSettings(), [], undefined);

  const weekStartDay = settings?.weekStart ?? 1;
  const from: ISODate =
    period === 'week'
      ? startOfWeek(anchor, weekStartDay)
      : period === 'month'
        ? startOfMonth(anchor)
        : startOfYear(anchor);
  const to: ISODate =
    period === 'week'
      ? addDays(from, 6)
      : period === 'month'
        ? endOfMonth(anchor)
        : endOfYear(anchor);

  const queryFrom = addDays(from, -7);
  const queryTo = addDays(to, 7);

  const movements = useLiveQuery(
    () => listMovementsRange(queryFrom, queryTo),
    [queryFrom, queryTo],
    [] as Movement[],
  );
  const days = useLiveQuery(
    () => listDaysRange(queryFrom, queryTo),
    [queryFrom, queryTo],
    [] as DayEntry[],
  );

  const totals = settings
    ? periodTotals(
        from,
        to,
        movements,
        settings,
        true,
        days,
        period === 'month' ? 'period' : 'weekly',
      )
    : null;
  const inPeriod = movements.filter(
    (movement) => movement.date >= from && movement.date <= to,
  );
  const registeredDays = new Set(inPeriod.map((movement) => movement.date)).size;
  const leaveDays: Record<Exclude<DayKind, 'work'>, number> = {
    vacation: 0,
    personal: 0,
    sick: 0,
    holiday: 0,
  };
  for (const day of days) {
    if (day.date < from || day.date > to || day.kind === 'work') continue;
    leaveDays[day.kind] += 1;
  }
  const medicalMinutes = inPeriod
    .filter((movement) => movement.category === 'medical')
    .reduce((total, movement) => total + durationMinutes(movement), 0);
  const hasAbsences =
    medicalMinutes > 0 || Object.values(leaveDays).some((count) => count > 0);
  const periodLabel =
    period === 'week'
      ? 'En esta semana'
      : period === 'month'
        ? 'En este mes'
        : 'En este año';

  const title =
    period === 'week'
      ? formatWeekRangeShort(from, to)
      : period === 'month'
        ? formatMonthYear(anchor)
        : String(parseISO(anchor).getFullYear());

  const periodDays = settings
    ? daysOfWeek(from, movements, settings, days)
    : [];
  const periodWeeks = settings
    ? weeklyBreakdown(from, to, movements, settings, days)
    : [];
  const periodMonths = settings
    ? monthlyBreakdown(anchor, movements, settings, days)
    : [];
  const maxScheduledDay = Math.max(
    1,
    ...periodDays.map((day) => day.target + day.excused),
  );
  const maxDayExtraRatio = Math.max(
    0,
    ...periodDays.map((day) => {
      const dayTarget = day.target + day.excused || maxScheduledDay;
      return Math.max(0, day.worked - day.target) / dayTarget;
    }),
  );
  const dayTargetTrackWidth = 100 / (1 + maxDayExtraRatio);
  const maxMonth = Math.max(
    1,
    ...periodMonths.map(
      (month) => month.worked + Object.values(month.excused).reduce((sum, n) => sum + n, 0),
    ),
  );

  function shift(direction: -1 | 1) {
    if (period === 'week') setAnchor(addDays(anchor, direction * 7));
    else if (period === 'month') setAnchor(addMonths(anchor, direction));
    else setAnchor(addYears(anchor, direction));
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="Resumen"
        subtitle="Horas, objetivos y extras"
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

      <Segmented
        value={period}
        options={PERIOD_OPTIONS}
        onChange={(value) => setPeriod(value as Period)}
        label="Periodo del resumen"
      />

      <div className="card card-pad">
        <PeriodNavigator
          title={title}
          subtitle={
            period === 'week'
              ? 'Semana completa'
              : period === 'month'
                ? 'Mes completo'
                : 'Año completo'
          }
          onPrevious={() => shift(-1)}
          onNext={() => shift(1)}
          previousLabel="Periodo anterior"
          nextLabel="Periodo siguiente"
        />
      </div>

      {totals ? (
        <>
          <section className="hero" aria-label="Totales del periodo">
            <div className="row-between">
              <span className="hero-label">Horas trabajadas</span>
              {totals.extra > 0 ? (
                <span className="hero-pill">
                  <Icon name="chart" size={13} />
                  +{formatDuration(totals.extra)} extra
                </span>
              ) : null}
            </div>
            <div className="hero-value">{formatDuration(totals.worked)}</div>
            <div className="hero-meta">
              <span>Objetivo {formatDuration(totals.target)}</span>
              <span>
                {totals.diff >= 0
                  ? `+${formatDuration(totals.diff)}`
                  : `Faltan ${formatDuration(Math.abs(totals.diff))}`}
              </span>
            </div>
            <div className="hero-footer">
              <ProgressBar
                value={totals.target > 0 ? totals.worked / totals.target : 0}
              />
            </div>
          </section>

          <div className="stat-grid three">
            <div className="stat">
              <div className="stat-label">Objetivo</div>
              <div className="stat-value">{formatDuration(totals.target)}</div>
              <div className="stat-note">
                {period === 'week' ? 'De esta semana' : 'Del periodo'}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Extra</div>
              <div className="stat-value">
                {totals.extra > 0 ? formatDuration(totals.extra) : '—'}
              </div>
              <div className="stat-note">
                {period === 'month'
                  ? 'Balance del mes'
                  : 'Calculado por semana'}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Días</div>
              <div className="stat-value">{registeredDays}</div>
              <div className="stat-note">Con horas registradas</div>
            </div>
          </div>

          {period === 'week' ? (
            <section className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Días de la semana</div>
                  <div className="card-subtitle">
                    {formatWeekday(from)} a {formatWeekday(to)}
                  </div>
                  <div className="day-hours-legend" aria-label="Leyenda de horas">
                    <span><i className="day-hours-swatch target" /> Hasta objetivo</span>
                    <span><i className="day-hours-swatch excess" /> Exceso diario</span>
                    {ABSENCE_KINDS.map((item) => (
                      <span key={item.value}>
                        <i className={`day-hours-swatch ${item.chipClass}`} />{' '}
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="list">
                {periodDays.map((day) => (
                  <div className="breakdown-row" key={day.date}>
                    <span className="breakdown-name">
                      {formatWeekday(day.date)} {formatShortDate(day.date)}
                    </span>
                    <div className="breakdown-bar">
                      <div
                        className="progress day-hours-track"
                        style={{ height: 8, width: `${dayTargetTrackWidth}%` }}
                        role="img"
                         aria-label={`${formatDuration(day.worked)} trabajadas; objetivo ajustado ${formatDuration(day.target)}${day.excused ? `; ${formatDuration(day.excused)} de ${dayKindInfo(day.kind).label.toLowerCase()}` : ''}`}
                       >
                         {day.excused > 0 ? (
                           <span
                              className={`day-hours-segment ${day.kind}`}
                              style={{
                                width: `${(day.excused / (day.target + day.excused || maxScheduledDay)) * 100}%`,
                             }}
                           />
                         ) : (
                           <>
                             <span
                                className="day-hours-segment target"
                                style={{
                                  width: `${(Math.min(day.worked, day.target) / (day.target + day.excused || maxScheduledDay)) * 100}%`,
                               }}
                             />
                             {day.worked > day.target ? (
                               <span
                                  className="day-hours-segment excess"
                                  style={{
                                    width: `${((day.worked - day.target) / (day.target + day.excused || maxScheduledDay)) * 100}%`,
                                 }}
                               />
                             ) : null}
                           </>
                         )}
                      </div>
                    </div>
                    <span
                      className="breakdown-value"
                      title={`Objetivo ${formatDuration(day.target)}`}
                    >
                      {formatDuration(day.worked)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {period === 'month' ? (
            <section className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Semanas del mes</div>
                  <div className="card-subtitle">
                    Días del mes agrupados por semanas
                  </div>
                  <div className="day-hours-legend" aria-label="Leyenda de horas">
                    <span><i className="day-hours-swatch target" /> Trabajadas</span>
                    {ABSENCE_KINDS.map((item) => (
                      <span key={item.value}>
                        <i className={`day-hours-swatch ${item.chipClass}`} />{' '}
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="list">
                {periodWeeks.map((week) => {
                  const excusedMinutes = Object.values(week.excused).reduce(
                    (sum, minutes) => sum + minutes,
                    0,
                  );
                  const barScale = Math.max(
                    1,
                    week.target + excusedMinutes,
                    week.worked + excusedMinutes,
                  );
                  return (
                  <div className="breakdown-row" key={week.start}>
                    <span className="breakdown-name" style={{ width: 92 }}>
                      {formatShortDate(week.start)} –{' '}
                      {formatShortDate(week.end)}
                    </span>
                    <div className="breakdown-bar">
                      <div className="progress" style={{ height: 6 }}>
                        <div className="hours-stack">
                          <span
                            className="hours-stack-segment worked"
                            style={{ width: `${(week.worked / barScale) * 100}%` }}
                          />
                          {ABSENCE_KINDS.map((item) =>
                            week.excused[item.value] > 0 ? (
                              <span
                                key={item.value}
                                className={`hours-stack-segment ${item.chipClass}`}
                                style={{
                                  width: `${(week.excused[item.value] / barScale) * 100}%`,
                                }}
                              />
                            ) : null,
                          )}
                        </div>
                      </div>
                    </div>
                    {week.extra > 0 ? (
                      <span className="badge warning">
                        +{formatCompactDuration(week.extra)}
                      </span>
                    ) : null}
                    <span className="breakdown-value">
                      {formatDuration(week.worked)}
                    </span>
                  </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {period === 'year' ? (
            <section className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Meses del año</div>
                  <div className="card-subtitle">
                    Horas trabajadas y justificadas por mes
                  </div>
                  <div className="day-hours-legend" aria-label="Leyenda de horas">
                    <span><i className="day-hours-swatch target" /> Trabajadas</span>
                    {ABSENCE_KINDS.map((item) => (
                      <span key={item.value}>
                        <i className={`day-hours-swatch ${item.chipClass}`} />{' '}
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="list">
                {periodMonths.map((month) => (
                  <div className="breakdown-row" key={month.month}>
                    <span className="breakdown-name">
                      {formatMonth(month.month)}
                    </span>
                    <div className="breakdown-bar">
                      <div className="progress" style={{ height: 6 }}>
                        <div className="hours-stack">
                          <span
                            className="hours-stack-segment worked"
                            style={{ width: `${(month.worked / maxMonth) * 100}%` }}
                          />
                          {ABSENCE_KINDS.map((item) =>
                            month.excused[item.value] > 0 ? (
                              <span
                                key={item.value}
                                className={`hours-stack-segment ${item.chipClass}`}
                                style={{
                                  width: `${(month.excused[item.value] / maxMonth) * 100}%`,
                                }}
                              />
                            ) : null,
                          )}
                        </div>
                      </div>
                    </div>
                    <span
                      className="breakdown-value"
                      title={`Objetivo ${formatDuration(month.target)}`}
                    >
                      {formatDuration(month.worked)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {period === 'year' ? (
            <div className="banner">
              <Icon name="info" size={16} />
              <span>
                Las extras se calculan por semanas; en este resumen solo se
                cuentan los días incluidos en el periodo seleccionado.
              </span>
            </div>
          ) : null}

          <section className="card absence-card">
            <div className="card-header">
              <div>
                <div className="card-title">Vacaciones y ausencias</div>
                <div className="card-subtitle">{periodLabel}</div>
              </div>
            </div>
            {hasAbsences ? (
              <div className="absence-list">
                {leaveDays.vacation > 0 ? (
                  <div className="absence-row">
                    <span className="absence-dot vacation" />
                    <span className="absence-label">Vacaciones</span>
                    <span className="absence-value">
                      {formatDayCount(leaveDays.vacation)}
                    </span>
                  </div>
                ) : null}
                {leaveDays.personal > 0 ? (
                  <div className="absence-row">
                    <span className="absence-dot personal" />
                    <span className="absence-label">Asunto propio</span>
                    <span className="absence-value">
                      {formatDayCount(leaveDays.personal)}
                    </span>
                  </div>
                ) : null}
                {leaveDays.sick > 0 ? (
                  <div className="absence-row">
                    <span className="absence-dot sick" />
                    <span className="absence-label">Baja</span>
                    <span className="absence-value">
                      {formatDayCount(leaveDays.sick)}
                    </span>
                  </div>
                ) : null}
                {leaveDays.holiday > 0 ? (
                  <div className="absence-row">
                    <span className="absence-dot holiday" />
                    <span className="absence-label">Festivos</span>
                    <span className="absence-value">
                      {formatDayCount(leaveDays.holiday)}
                    </span>
                  </div>
                ) : null}
                {medicalMinutes > 0 ? (
                  <div className="absence-row">
                    <span className="absence-dot medical" />
                    <span className="absence-label">Tiempo de médico</span>
                    <span className="absence-value medical">
                      {formatDuration(medicalMinutes)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="empty-text" style={{ padding: '18px 16px' }}>
                Sin vacaciones, asuntos propios, bajas ni tiempo de médico en
                este periodo.
              </p>
            )}
          </section>
        </>
      ) : (
        <div className="card card-pad">
          <div className="row-center">
            <span className="spinner" />
            <span className="small muted">Cargando resumen…</span>
          </div>
        </div>
      )}

      {exportOpen ? (
        <ExportPdfModal
          initialPeriod={period}
          initialAnchor={anchor}
          onClose={() => setExportOpen(false)}
        />
      ) : null}
    </div>
  );
}
