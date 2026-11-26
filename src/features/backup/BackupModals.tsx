import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { formatFileSize } from '../../domain/time';
import { downloadBlob, shareBlob } from '../../utils/download';
import { applyBackup, readBackup } from '../../backup/import';
import {
  attachmentsBackupFileName,
  createAttachmentsBackup,
  restoreAttachmentsBackup,
} from '../../backup/v2/attachments';
import {
  applyDataBackup,
  createDataBackup,
  dataBackupFileName,
  readDataBackup,
} from '../../backup/v2/data';
import { detectBackupKind } from '../../backup/v2/detect';
import type { BackupFileKind } from '../../backup/v2/format';
import type { ProgressInfo } from '../../backup/format';
import { scorePassword } from '../../backup/password';

function phaseLabel(progress: ProgressInfo | null): string {
  if (!progress) return 'Preparando…';
  let label = 'Procesando…';
  switch (progress.phase) {
    case 'reading':
      label = 'Leyendo datos…';
      break;
    case 'encrypting':
      label = 'Cifrando…';
      break;
    case 'decrypting':
      label = 'Descifrando…';
      break;
    case 'writing':
      label = 'Guardando datos…';
      break;
    default:
      break;
  }
  return progress.detail ? `${label} · ${progress.detail}` : label;
}

function kindLabel(kind: BackupFileKind): string {
  switch (kind) {
    case 'data':
      return 'Copia de datos';
    case 'attachments':
      return 'Copia de adjuntos';
    case 'legacy':
      return 'Copia completa antigua';
    default:
      return 'Archivo no reconocido';
  }
}

interface ExportBackupModalProps {
  mode: 'data' | 'attachments';
  year?: string;
  attachmentCount: number;
  attachmentSize: number;
  onClose: () => void;
  onExported: () => void;
}

export function ExportBackupModal({
  mode,
  year,
  attachmentCount,
  attachmentSize,
  onClose,
  onExported,
}: ExportBackupModalProps) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState('');
  const [lastExport, setLastExport] = useState<{
    blob: Blob;
    filename: string;
    size: number;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const strength = scorePassword(password);

  async function handleExport() {
    setError('');
    if (password.length < 8) {
      setError('Usa una contraseña de al menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (mode === 'attachments' && !year) {
      setError('Elige un año con adjuntos.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress(null);
    try {
      const backup =
        mode === 'data'
          ? await createDataBackup(password, {
              signal: controller.signal,
              onProgress: setProgress,
            })
          : await createAttachmentsBackup(year as string, password, {
              signal: controller.signal,
              onProgress: setProgress,
            });
      const filename =
        mode === 'data'
          ? dataBackupFileName()
          : attachmentsBackupFileName(year as string);
      setLastExport({ blob: backup, filename, size: backup.size });
      toast(
        mode === 'data'
          ? `Copia de datos creada (${formatFileSize(backup.size)}).`
          : `Adjuntos de ${year} preparados (${formatFileSize(backup.size)}).`,
        'success',
      );
    } catch (exportError) {
      if ((exportError as Error).name === 'AbortError') {
        toast('Exportación cancelada.', 'info');
      } else {
        setError(
          (exportError as Error).message || 'No se pudo crear la copia.',
        );
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      setProgress(null);
    }
  }

  async function shareLastExport() {
    if (!lastExport) return;
    setError('');
    try {
      const shared = await shareBlob(
        lastExport.blob,
        lastExport.filename,
        mode === 'data' ? 'Copia de datos de Mis Horas' : 'Adjuntos de Mis Horas',
      );
      if (!shared) {
        downloadBlob(lastExport.blob, lastExport.filename);
        onExported();
        toast('El menú de compartir no está disponible. Se ha descargado la copia.', 'info');
      } else {
        onExported();
        toast('Copia compartida. Guárdala en iCloud Drive, Google Drive o Files.', 'success');
        onClose();
      }
    } catch (shareError) {
      if ((shareError as Error).name === 'AbortError') return;
      setError((shareError as Error).message || 'No se pudo compartir la copia.');
    }
  }

  return (
    <Modal
      title={
        mode === 'data'
          ? 'Exportar copia de datos'
          : `Exportar adjuntos de ${year ?? ''}`
      }
      subtitle="AES-256-GCM · PBKDF2-SHA-256 · 600.000 iteraciones"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (busy) abortRef.current?.abort();
              else onClose();
            }}
          >
            {busy ? 'Cancelar' : 'Cerrar'}
          </button>
          {lastExport ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void shareLastExport()}
            >
              <Icon name="share" size={17} />
              Compartir
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleExport()}
              disabled={busy || (mode === 'attachments' && !year)}
            >
              {busy ? (
                <span className="spinner on-primary" />
              ) : (
                <Icon name="download" size={17} />
              )}
              {mode === 'data' ? 'Exportar datos' : 'Exportar adjuntos'}
            </button>
          )}
        </>
      }
    >
      <p className="field-hint">
        {mode === 'data'
          ? 'Incluye horas, días, ajustes y la lista de fotos. No incluye las fotos.'
          : `Incluye solo las fotos de ${year}. No incluye horas ni ajustes.`}
      </p>

      {lastExport ? (
        <div className="banner success">
          <Icon name="check" size={16} />
          <span>
            Copia lista: {lastExport.filename} ({formatFileSize(lastExport.size)}).
            En iPhone, pulsa «Compartir» para guardarla en iCloud Drive, Google
            Drive o Files.
          </span>
        </div>
      ) : null}

      {lastExport ? (
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => {
            downloadBlob(lastExport.blob, lastExport.filename);
            onExported();
          }}
        >
          <Icon name="download" size={17} />
          Descargar archivo
        </button>
      ) : null}

      {mode === 'attachments' && attachmentCount > 0 && !lastExport ? (
        <p className="field-hint">
          Se incluirán {attachmentCount}{' '}
          {attachmentCount === 1 ? 'adjunto' : 'adjuntos'} (
          {formatFileSize(attachmentSize)}).
          {attachmentSize > 250 * 1024 * 1024
            ? ' Año grande: puede tardar; si falla, expórtalo desde un ordenador.'
            : ''}
        </p>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="backup-password">
          Contraseña de la copia
        </label>
        <input
          id="backup-password"
          className="input"
          type={showPassword ? 'text' : 'password'}
          value={password}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Mínimo 8 caracteres"
        />
        {password ? (
          <div>
            <div className="progress" style={{ height: 5 }}>
              <div
                className="progress-bar"
                style={{
                  width: `${strength.percent}%`,
                  background: strength.color,
                }}
              />
            </div>
            <div className="row-between" style={{ marginTop: 4 }}>
              <span className="tiny muted">Seguridad</span>
              <span className="tiny" style={{ color: strength.color }}>
                {strength.label}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="backup-password-confirm">
          Repite la contraseña
        </label>
        <input
          id="backup-password-confirm"
          className="input"
          type={showPassword ? 'text' : 'password'}
          value={confirmation}
          autoComplete="new-password"
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="Repite la contraseña"
        />
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={showPassword}
          onChange={(event) => setShowPassword(event.target.checked)}
        />
        <span>Mostrar contraseñas</span>
      </label>

      {progress ? (
        <div className="processing-card">
          <div className="processing-head">
            <span className="row-center">
              <span className="spinner" />
              {phaseLabel(progress)}
            </span>
            <span>{Math.round(progress.percent * 100)} %</span>
          </div>
          <div className="progress">
            <div
              className="progress-bar"
              style={{ width: `${Math.round(progress.percent * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}

interface ImportBackupModalProps {
  onClose: () => void;
  onImported: () => void;
}

export function ImportBackupModal({
  onClose,
  onImported,
}: ImportBackupModalProps) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<BackupFileKind>('unknown');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const destructive = kind === 'data' || kind === 'legacy';

  async function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setConfirmed(false);
    setError('');
    if (!nextFile) {
      setKind('unknown');
      return;
    }
    const detected = await detectBackupKind(nextFile);
    setKind(detected);
    if (detected === 'unknown') {
      setError('El archivo no es una copia de Mis Horas.');
    }
  }

  async function handleImport() {
    setError('');
    if (!file) {
      setError('Selecciona un archivo de copia.');
      return;
    }
    if (kind === 'unknown') {
      setError('El archivo no es una copia de Mis Horas.');
      return;
    }
    if (!password) {
      setError('Introduce la contraseña de la copia.');
      return;
    }
    if (destructive && !confirmed) {
      setError('Confirma que entiendes que se reemplazarán los datos actuales.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress(null);
    try {
      if (kind === 'data') {
        const payload = await readDataBackup(file, password, {
          signal: controller.signal,
          onProgress: setProgress,
        });
        const result = await applyDataBackup(payload, setProgress);
        toast(
          `Datos restaurados: ${result.movements} tramos. ${
            result.archived > 0
              ? `${result.archived} fotos quedan archivadas hasta restaurar sus archivos.`
              : 'Todas las fotos están disponibles.'
          }`,
          result.archived > 0 ? 'info' : 'success',
        );
      } else if (kind === 'attachments') {
        const result = await restoreAttachmentsBackup(file, password, {
          signal: controller.signal,
          onProgress: setProgress,
        });
        toast(
          `${result.restored} de ${result.total} fotos restauradas.`,
          'success',
        );
      } else {
        const parsed = await readBackup(file, password, {
          signal: controller.signal,
          onProgress: setProgress,
        });
        await applyBackup(parsed, setProgress);
        toast(
          `Copia restaurada: ${parsed.meta.movements.length} tramos y ${parsed.attachments.length} adjuntos.`,
          'success',
        );
      }
      onImported();
      onClose();
    } catch (importError) {
      if ((importError as Error).name === 'AbortError') {
        toast('Restauración cancelada.', 'info');
      } else {
        setError(
          (importError as Error).message || 'No se pudo restaurar la copia.',
        );
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      setProgress(null);
    }
  }

  return (
    <Modal
      title="Restaurar copia"
      subtitle={
        kind === 'attachments'
          ? 'Añade o actualiza fotos'
          : kind === 'data'
            ? 'Sustituye los datos y conserva las fotos disponibles'
            : 'Selecciona el archivo que quieres restaurar'
      }
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (busy) abortRef.current?.abort();
              else onClose();
            }}
          >
            {busy ? 'Cancelar' : 'Cerrar'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleImport()}
            disabled={
              busy ||
              !file ||
              !password ||
              kind === 'unknown' ||
              (destructive && !confirmed)
            }
          >
            {busy ? (
              <span className="spinner on-primary" />
            ) : (
              <Icon name="upload" size={17} />
            )}
            Restaurar
          </button>
        </>
      }
    >
      {kind === 'attachments' ? (
        <p className="field-hint">
          Se añadirán las fotos del año. No se borran las horas ni las demás
          fotos.
        </p>
      ) : null}

      {kind === 'data' || kind === 'legacy' ? (
        <div className="banner danger">
          <Icon name="alert" size={16} />
          <span>
            {kind === 'data'
              ? 'Se reemplazarán las horas, los días y los ajustes. Las fotos existentes se conservan.'
              : 'Se reemplazará todo por el contenido de la copia antigua.'}
          </span>
        </div>
      ) : null}

      <div className="field">
        <span className="field-label">Archivo de copia</span>
        <label className="btn btn-secondary btn-block" style={{ cursor: 'pointer' }}>
          <Icon name="upload" size={17} />
          {file ? 'Cambiar archivo' : 'Elegir archivo de copia'}
          <input
            type="file"
            accept=".mhbackup,.mhdata,.mhatt,application/octet-stream"
            className="hidden"
            onChange={(event) => {
              void selectFile(event.target.files?.[0] ?? null);
              event.target.value = '';
            }}
          />
        </label>
        {file ? (
          <span className="field-hint">
            {file.name} · {formatFileSize(file.size)} · {kindLabel(kind)}
          </span>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="import-password">
          Contraseña de la copia
        </label>
        <input
          id="import-password"
          className="input"
          type={showPassword ? 'text' : 'password'}
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Contraseña usada al exportar"
        />
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={showPassword}
          onChange={(event) => setShowPassword(event.target.checked)}
        />
        <span>Mostrar contraseña</span>
      </label>

      {destructive ? (
        <label className="check-row">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            {kind === 'data'
              ? 'Entiendo que se reemplazarán los datos actuales y que las fotos que falten quedarán archivadas.'
              : 'Entiendo que se reemplazarán todos los datos actuales por los de la copia.'}
          </span>
        </label>
      ) : null}

      {progress ? (
        <div className="processing-card">
          <div className="processing-head">
            <span className="row-center">
              <span className="spinner" />
              {phaseLabel(progress)}
            </span>
            <span>{Math.round(progress.percent * 100)} %</span>
          </div>
          <div className="progress">
            <div
              className="progress-bar"
              style={{ width: `${Math.round(progress.percent * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}
