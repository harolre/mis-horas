import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Account, ISODate, Movement } from '../../types';
import { getSettings, listAccounts, listMovementsRange } from '../../db/repos';
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
  formatWeekTitle,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
  todayISO,
} from '../../domain/date';
import {
  formatCompactDuration,
  formatDuration,
} from '../../domain/time';
import {
  daysOfWeek,
  monthlyBreakdown,
  periodTotals,
  weeklyBreakdown,
} from '../../domain/totals';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../components/Icon';
import { ProgressBar } from '../../components/ProgressBar';
import { Segmented } from '../../components/Segmented';

type Period = 'week' | 'month' | 'year';

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
];

interface SummaryScreenProps {
  initialDate: string;
}

export function SummaryScreen({ initialDate }: SummaryScreenProps) {
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(initialDate || todayISO());

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const accounts = useLiveQuery(
    () => listAccounts(true),
    [],
    [] as Account[],
  );

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

  const totals = settings ? periodTotals(from, to, movements, settings) : null;
  const inPeriod = movements.filter(
    (movement) => movement.date >= from && movement.date <= to,
  );
  const registeredDays = new Set(inPeriod.map((movement) => movement.date)).size;

  const title =
    period === 'week'
      ? formatWeekTitle(from, to)
      : period === 'month'
        ? formatMonthYear(anchor)
        : String(parseISO(anchor).getFullYear());

  const accountTotals = accounts
    .map((account) => ({
      account,
      minutes: totals?.perAccount[account.id] ?? 0,
    }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const maxAccount = Math.max(1, ...accountTotals.map((item) => item.minutes));

  const periodDays = settings ? daysOfWeek(from, movements, settings) : [];
  const periodWeeks = settings
    ? weeklyBreakdown(from, to, movements, settings)
    : [];
  const periodMonths = settings
    ? monthlyBreakdown(anchor, movements, settings)
    : [];
  const maxDay = Math.max(1, ...periodDays.map((day) => day.worked));
  const maxWeek = Math.max(1, ...periodWeeks.map((week) => week.worked));
  const maxMonth = Math.max(1, ...periodMonths.map((month) => month.worked));

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
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAnchor(todayISO())}
          >
            Hoy
          </button>
        }
      />

      <Segmented
        value={period}
        options={PERIOD_OPTIONS}
        onChange={(value) => setPeriod(value as Period)}
        label="Periodo del resumen"
      />

      <div className="card card-pad row-between">
        <button
          type="button"
          className="icon-button plain"
          onClick={() => shift(-1)}
          aria-label="Periodo anterior"
        >
          <Icon name="chevron-left" size={19} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="period-title">{title}</div>
          <div className="period-subtitle">
            {period === 'week'
              ? 'Semana completa'
              : period === 'month'
                ? 'Extra por semanas que empiezan en el mes'
                : 'Extra por semanas que empiezan en el año'}
          </div>
        </div>
        <button
          type="button"
          className="icon-button plain"
          onClick={() => shift(1)}
          aria-label="Periodo siguiente"
        >
          <Icon name="chevron-right" size={19} />
        </button>
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
              <div className="stat-note">Calculado por semana</div>
            </div>
            <div className="stat">
              <div className="stat-label">Días</div>
              <div className="stat-value">{registeredDays}</div>
              <div className="stat-note">Con horas registradas</div>
            </div>
          </div>

          <section className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Por cuenta</div>
                <div className="card-subtitle">
                  Horas del periodo seleccionado
                </div>
              </div>
            </div>
            {accountTotals.length === 0 ? (
              <p className="empty-text" style={{ padding: '18px 16px' }}>
                No hay horas registradas en este periodo.
              </p>
            ) : (
              <div className="list">
                {accountTotals.map(({ account, minutes }) => (
                  <div className="breakdown-row" key={account.id}>
                    <span
                      className="account-breakdown-dot"
                      style={{ background: account.color }}
                    />
                    <span
                      className="breakdown-name"
                      title={account.name}
                      style={{ width: 92 }}
                    >
                      {account.name}
                      {account.archived ? ' ·' : ''}
                    </span>
                    <div className="breakdown-bar">
                      <div className="progress" style={{ height: 6 }}>
                        <div
                          className="progress-bar"
                          style={{
                            width: `${(minutes / maxAccount) * 100}%`,
                            background: account.color,
                          }}
                        />
                      </div>
                    </div>
                    <span className="breakdown-value">
                      {formatDuration(minutes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {period === 'week' ? (
            <section className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Días de la semana</div>
                  <div className="card-subtitle">
                    {formatWeekday(from)} a {formatWeekday(to)}
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
                      <div className="progress" style={{ height: 6 }}>
                        <div
                          className="progress-bar"
                          style={{
                            width: `${(day.worked / maxDay) * 100}%`,
                          }}
                        />
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
                    Solo semanas cuyo lunes cae en el mes
                  </div>
                </div>
              </div>
              <div className="list">
                {periodWeeks.map((week) => (
                  <div className="breakdown-row" key={week.start}>
                    <span className="breakdown-name" style={{ width: 92 }}>
                      {formatShortDate(week.start)} –{' '}
                      {formatShortDate(week.end)}
                    </span>
                    <div className="breakdown-bar">
                      <div className="progress" style={{ height: 6 }}>
                        <div
                          className="progress-bar"
                          style={{
                            width: `${(week.worked / maxWeek) * 100}%`,
                          }}
                        />
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
                ))}
              </div>
            </section>
          ) : null}

          {period === 'year' ? (
            <section className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Meses del año</div>
                  <div className="card-subtitle">
                    Horas registradas y objetivo mensual
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
                        <div
                          className="progress-bar"
                          style={{
                            width: `${(month.worked / maxMonth) * 100}%`,
                          }}
                        />
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

          {period !== 'week' ? (
            <div className="banner">
              <Icon name="info" size={16} />
              <span>
                El exceso se calcula por semanas completas: se suman los extras
                de las semanas cuyo lunes cae dentro del periodo.
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="card card-pad">
          <div className="row-center">
            <span className="spinner" />
            <span className="small muted">Cargando resumen…</span>
          </div>
        </div>
      )}
    </div>
  );
}
