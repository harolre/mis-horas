import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ThemeMode, Weekday } from '../../types';
import {
  attachmentStats,
  attachmentYears,
  eraseAllData,
  getSettings,
  saveSettings,
  weekdayLabel,
  type AttachmentYear,
} from '../../db/repos';
import {
  formatDuration,
  formatFileSize,
  hoursToMinutes,
  minutesToHoursInput,
} from '../../domain/time';
import { todayISO } from '../../domain/date';
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
    { count: 0, totalSize: 0, archivedCount: 0 },
  );
  const attachmentYearList = useLiveQuery(
    () => attachmentYears(),
    [],
    [] as AttachmentYear[],
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
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [exportDataOpen, setExportDataOpen] = useState(false);
  const [exportAttachmentsOpen, setExportAttachmentsOpen] = useState(false);
  const [exportYear, setExportYear] = useState(todayISO().slice(0, 4));
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

  useEffect(() => {
    if (
      attachmentYearList.length > 0 &&
      !attachmentYearList.some((item) => item.year === exportYear)
    ) {
      setExportYear(attachmentYearList[0].year);
    }
  }, [attachmentYearList, exportYear]);

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
  const selectedYearStats = attachmentYearList.find(
    (item) => item.year === exportYear,
  );
  const averageAttachmentSize =
    stats.count - stats.archivedCount > 0
      ? stats.totalSize / (stats.count - stats.archivedCount)
      : 0;
  const lastBackupTime = lastBackup ? Date.parse(lastBackup) : Number.NaN;
  const backupOverdue =
    !lastBackup ||
    !Number.isFinite(lastBackupTime) ||
    Date.now() - lastBackupTime > 30 * 24 * 60 * 60 * 1000;

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
                {stats.archivedCount > 0
                  ? ` · ${stats.archivedCount} archivado${
                      stats.archivedCount === 1 ? '' : 's'
                    }`
                  : ''}
              </div>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-title">Media por adjunto</div>
              <div className="settings-desc">
                {averageAttachmentSize > 0
                  ? formatFileSize(Math.round(averageAttachmentSize))
                  : 'Sin adjuntos todavía'}
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
                <div className="settings-title">Copia de datos</div>
                <div className="settings-desc">
                  Horas, días, cuentas, ajustes y la lista de fotos. No incluye
                  las fotos, así que es pequeña y rápida.
                </div>
              </div>
              <Icon name="lock" size={20} />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => setExportDataOpen(true)}
            >
              <Icon name="download" size={17} />
              Exportar datos
            </button>
          </div>

          <div className="settings-row column" style={{ gap: 10 }}>
            <div>
              <div className="settings-title">Copia de adjuntos</div>
              <div className="settings-desc">
                Fotos comprimidas de un año. Se guardan y restauran por
                separado, sin cargar todos los años a la vez.
              </div>
            </div>
            {attachmentYearList.length > 0 ? (
              <>
                <div className="row-between" style={{ gap: 10 }}>
                  <select
                    className="select"
                    value={exportYear}
                    onChange={(event) => setExportYear(event.target.value)}
                    aria-label="Año de los adjuntos"
                  >
                    {attachmentYearList.map((item) => (
                      <option key={item.year} value={item.year}>
                        {item.year} · {item.availableCount} disponible
                        {item.availableCount === 1 ? '' : 's'}
                        {item.archivedCount > 0
                          ? ` · ${item.archivedCount} archivado${
                              item.archivedCount === 1 ? '' : 's'
                            }`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <span className="tiny muted">
                    {selectedYearStats
                      ? formatFileSize(selectedYearStats.totalSize)
                      : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={() => setExportAttachmentsOpen(true)}
                  disabled={(selectedYearStats?.availableCount ?? 0) === 0}
                >
                  <Icon name="download" size={17} />
                  Exportar adjuntos de {exportYear}
                </button>
                {selectedYearStats &&
                selectedYearStats.availableCount === 0 ? (
                  <p className="field-hint">
                    Las fotos de este año están archivadas. Restaura primero su
                    archivo de adjuntos.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="field-hint">Todavía no hay fotos para exportar.</p>
            )}
          </div>

          <div className="settings-row column" style={{ gap: 10 }}>
            <div>
              <div className="settings-title">Restaurar copia</div>
              <div className="settings-desc">
                Restaura los datos, las fotos de un año o una copia completa
                antigua. La app detecta el tipo de archivo.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => setImportOpen(true)}
            >
              <Icon name="upload" size={17} />
              Elegir archivo de copia
            </button>
            <div className="tiny muted">
              Última exportación: {formatLastBackup(lastBackup)}
            </div>
            <p className="field-hint">
              La contraseña no se guarda. Sin ella, la copia no se puede
              recuperar.
            </p>
            {backupOverdue ? (
              <p className="field-hint">
                {lastBackup
                  ? 'Han pasado más de 30 días desde la última exportación.'
                  : 'Todavía no has exportado ninguna copia.'}
              </p>
            ) : null}
          </div>
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

      {exportDataOpen ? (
        <ExportBackupModal
          mode="data"
          attachmentCount={stats.count}
          attachmentSize={stats.totalSize}
          onClose={() => setExportDataOpen(false)}
          onExported={markExported}
        />
      ) : null}

      {exportAttachmentsOpen ? (
        <ExportBackupModal
          mode="attachments"
          year={exportYear}
          attachmentCount={selectedYearStats?.count ?? 0}
          attachmentSize={selectedYearStats?.totalSize ?? 0}
          onClose={() => setExportAttachmentsOpen(false)}
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
