import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ThemeMode, Weekday } from '../../types';
import {
  attachmentStats,
  eraseAllData,
  getSettings,
  saveSettings,
  weekdayLabel,
} from '../../db/repos';
import {
  formatDuration,
  formatFileSize,
  hoursToMinutes,
  minutesToHoursInput,
} from '../../domain/time';
import { formatShortDate, todayISO } from '../../domain/date';
import { APP_VERSION } from '../../version';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../components/Icon';
import { Segmented } from '../../components/Segmented';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import {
  ExportBackupModal,
  ImportBackupModal,
} from '../backup/BackupModals';

interface SettingsScreenProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const THEME_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
];

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAILY_TARGET_OPTIONS = Array.from({ length: 97 }, (_, index) =>
  String(index * 15),
);

function formatLastBackup(value: string | null): string {
  if (!value) return 'Nunca';
  try {
    return new Date(value).toLocaleString('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

export function SettingsScreen({
  theme,
  onThemeChange,
}: SettingsScreenProps) {
  const toast = useToast();
  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const stats = useLiveQuery(
    () => attachmentStats(),
    [],
    { count: 0, totalSize: 0 },
  );
  const [targets, setTargets] = useState<string[]>([
    '8',
    '8',
    '8',
    '8',
    '8',
    '0',
    '0',
  ]);
  const [targetsDirty, setTargetsDirty] = useState(false);
  const [overrideDate, setOverrideDate] = useState(todayISO());
  const [overrideHours, setOverrideHours] = useState('0');
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseConfirmed, setEraseConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings && !targetsDirty) {
      setTargets(settings.dailyTargets.map(minutesToHoursInput));
    }
  }, [settings, targetsDirty]);

  useEffect(() => {
    try {
      setLastBackup(localStorage.getItem('mis-horas-last-backup'));
    } catch {
      // Sin acceso a almacenamiento auxiliar.
    }
    void refreshStorage();
  }, []);

  async function refreshStorage() {
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate) {
        setStorage({
          usage: estimate.usage ?? 0,
          quota: estimate.quota ?? 0,
        });
      } else setStorage(null);
    } catch {
      setStorage(null);
    }
  }

  const weeklyTarget = targets.reduce(
    (total, value) => total + (hoursToMinutes(value) ?? 0),
    0,
  );
  const overrides = settings
    ? Object.entries(settings.dateOverrides).sort(([a], [b]) =>
        a.localeCompare(b),
      )
    : [];

  function updateTarget(index: number, value: string) {
    setTargetsDirty(true);
    setTargets((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item)),
    );
  }

  async function saveTargets() {
    const minutes = targets.map((value) => hoursToMinutes(value));
    if (minutes.some((value) => value === null)) {
      toast('Revisa los objetivos: deben estar entre 0 y 24 h.', 'error');
      return;
    }
    try {
      await saveSettings({ dailyTargets: minutes as number[] });
      setTargetsDirty(false);
      toast('Objetivos diarios guardados.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  async function changeWeekStart(value: string) {
    try {
      await saveSettings({ weekStart: Number(value) as Weekday });
      toast('Inicio de semana actualizado.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  async function addOverride() {
    if (!settings) return;
    const minutes = hoursToMinutes(overrideHours);
    if (!overrideDate) {
      toast('Elige una fecha para la excepción.', 'error');
      return;
    }
    if (minutes === null) {
      toast('Introduce horas válidas para la excepción.', 'error');
      return;
    }
    try {
      await saveSettings({
        dateOverrides: {
          ...settings.dateOverrides,
          [overrideDate]: minutes,
        },
      });
      toast('Excepción guardada.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  async function removeOverride(date: string) {
    if (!settings) return;
    const next = { ...settings.dateOverrides };
    delete next[date];
    try {
      await saveSettings({ dateOverrides: next });
      toast('Excepción eliminada.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  function markExported() {
    const now = new Date().toISOString();
    try {
      localStorage.setItem('mis-horas-last-backup', now);
    } catch {
      // Sin almacenamiento auxiliar.
    }
    setLastBackup(now);
  }

  async function confirmErase() {
    if (!eraseConfirmed) {
      toast('Marca la casilla de confirmación para borrar los datos.', 'error');
      return;
    }
    setBusy(true);
    try {
      await eraseAllData();
      toast('Todos los datos han sido borrados.', 'success');
      setEraseOpen(false);
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const estimatedAvailable = storage && storage.quota > 0
    ? Math.max(0, storage.quota - storage.usage)
    : null;

  return (
    <div className="screen">
      <ScreenHeader
        title="Ajustes"
        subtitle="Preferencias, almacenamiento y copias"
      />

      <section className="settings-section">
        <h2 className="section-title">Apariencia</h2>
        <div className="settings-card">
          <div className="settings-row column" style={{ gap: 10 }}>
            <div>
              <div className="settings-title">Tema</div>
              <div className="settings-desc">
                Auto sigue el modo claro u oscuro del sistema.
              </div>
            </div>
            <Segmented
              value={theme}
              options={THEME_OPTIONS}
              onChange={(value) => onThemeChange(value as ThemeMode)}
              label="Tema de la app"
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Semana y objetivos</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <div className="settings-title">Inicio de semana</div>
              <div className="settings-desc">
                Afecta al calendario y al cálculo semanal del extra.
              </div>
            </div>
            <select
              className="select"
              style={{ maxWidth: 148 }}
              value={settings?.weekStart ?? 1}
              disabled={!settings}
              onChange={(event) => void changeWeekStart(event.target.value)}
              aria-label="Inicio de semana"
            >
              {([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((day) => (
                <option key={day} value={day}>
                  {weekdayLabel(day)}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row column" style={{ gap: 10 }}>
            <div className="row-between">
              <div>
                <div className="settings-title">Objetivo diario</div>
                <div className="settings-desc">
                  Horas objetivo para cada día de la semana.
                </div>
              </div>
              <span className="badge primary">
                {formatDuration(weeklyTarget)} / semana
              </span>
            </div>
            <div className="target-grid">
              {DAY_LABELS.map((day, index) => (
                <label className="target-item" key={day}>
                  <span className="target-day">{day}</span>
                  <select
                    className="target-input"
                    value={String(hoursToMinutes(targets[index] ?? '0') ?? 0)}
                    disabled={!settings}
                    onChange={(event) =>
                      updateTarget(index, String(Number(event.target.value) / 60))
                    }
                    aria-label={`Objetivo del ${weekdayLabel(
                      (index + 1) as Weekday,
                    )}`}
                  >
                    {DAILY_TARGET_OPTIONS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {formatDuration(Number(minutes))}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="row-between">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setTargets(['8', '8', '8', '8', '8', '0', '0']);
                  setTargetsDirty(true);
                }}
                disabled={!settings}
              >
                Restablecer 8 h L–V
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void saveTargets()}
                disabled={!settings || !targetsDirty}
              >
                Guardar objetivos
              </button>
            </div>
          </div>

          <div className="settings-row column" style={{ gap: 10 }}>
            <div>
              <div className="settings-title">Excepciones por fecha</div>
              <div className="settings-desc">
                Sustituyen el objetivo de un día concreto, por ejemplo el 24 de
                diciembre.
              </div>
            </div>
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void addOverride();
              }}
            >
              <div className="field">
                <label className="field-label" htmlFor="override-date">
                  Fecha
                </label>
                <input
                  id="override-date"
                  className="input"
                  type="date"
                  value={overrideDate}
                  onChange={(event) => setOverrideDate(event.target.value)}
                  disabled={!settings}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="override-hours">
                  Horas
                </label>
                <input
                  id="override-hours"
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={24}
                  step={0.25}
                  value={overrideHours}
                  onChange={(event) => setOverrideHours(event.target.value)}
                  disabled={!settings}
                />
              </div>
              <button
                type="submit"
                className="btn btn-secondary full"
                disabled={!settings}
              >
                <Icon name="plus" size={16} />
                Añadir excepción
              </button>
            </form>
            {overrides.length === 0 ? (
              <p className="field-hint">
                No hay excepciones. Se usan los objetivos semanales.
              </p>
            ) : (
              <div className="list">
                {overrides.map(([date, minutes]) => (
                  <div className="override-row" key={date}>
                    <span className="override-date">
                      {formatShortDate(date)}
                    </span>
                    <span className="override-hours">
                      {formatDuration(minutes)}
                    </span>
                    <button
                      type="button"
                      className="icon-button plain text-danger"
                      onClick={() => void removeOverride(date)}
                      aria-label={`Eliminar excepción del ${formatShortDate(
                        date,
                      )}`}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Almacenamiento</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <div className="settings-title">Adjuntos guardados</div>
              <div className="settings-desc">
                {stats.count} {stats.count === 1 ? 'archivo' : 'archivos'} ·{' '}
                {formatFileSize(stats.totalSize)}
              </div>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-title">Espacio disponible estimado</div>
              <div className="settings-desc">
                {estimatedAvailable === null
                  ? 'No disponible'
                  : formatFileSize(estimatedAvailable)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Copias de seguridad</h2>
        <div className="settings-card">
          <div className="settings-row column" style={{ gap: 10 }}>
            <div className="row-between">
              <div>
                <div className="settings-title">Copia cifrada</div>
                <div className="settings-desc">
                  Incluye todos los datos y los adjuntos comprimidos. Se cifra
                  con AES-256-GCM.
                </div>
              </div>
              <Icon name="lock" size={20} />
            </div>
            <div className="row-between tiny muted">
              <span>
                {stats.count} adjunto{stats.count === 1 ? '' : 's'} ·{' '}
                {formatFileSize(stats.totalSize)}
              </span>
              <span>Última: {formatLastBackup(lastBackup)}</span>
            </div>
            <div className="stack-sm">
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => setExportOpen(true)}
              >
                <Icon name="download" size={17} />
                Exportar copia cifrada
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() => setImportOpen(true)}
              >
                <Icon name="upload" size={17} />
                Importar copia cifrada
              </button>
            </div>
          </div>
        </div>
        <div className="banner warning">
          <Icon name="alert" size={16} />
          <span>
            La contraseña no se guarda en ningún sitio. Sin ella, la copia no se
            puede recuperar. Importar una copia reemplaza todos los datos
            actuales.
          </span>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Zona de riesgo</h2>
        <div className="settings-card danger-zone">
          <div className="settings-row">
            <div>
              <div className="settings-title text-danger">
                Borrar todos los datos
              </div>
              <div className="settings-desc">
                Elimina cuentas, tramos, notas, adjuntos y ajustes de este
                dispositivo. No se puede deshacer.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                setEraseConfirmed(false);
                setEraseOpen(true);
              }}
            >
              Borrar
            </button>
          </div>
        </div>
      </section>

      <p className="settings-footer">
        Mis Horas v{APP_VERSION}
        <br />
        Todos los datos permanecen en este dispositivo. Sin servidores ni
        sincronización.
      </p>

      {exportOpen ? (
        <ExportBackupModal
          attachmentCount={stats.count}
          attachmentSize={stats.totalSize}
          onClose={() => setExportOpen(false)}
          onExported={markExported}
        />
      ) : null}

      {importOpen ? (
        <ImportBackupModal
          onClose={() => setImportOpen(false)}
          onImported={() => void refreshStorage()}
        />
      ) : null}

      {eraseOpen ? (
        <ConfirmDialog
          title="Borrar todos los datos"
          message="Se borrarán todas las cuentas, tramos, notas, adjuntos y ajustes. Esta acción es irreversible."
          confirmLabel="Borrar todo"
          danger
          busy={busy}
          onConfirm={() => void confirmErase()}
          onClose={() => setEraseOpen(false)}
        >
          <label className="check-row">
            <input
              type="checkbox"
              checked={eraseConfirmed}
              onChange={(event) => setEraseConfirmed(event.target.checked)}
            />
            <span>
              Entiendo que se borrarán todos los datos y que no se pueden
              recuperar sin una copia de seguridad.
            </span>
          </label>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
