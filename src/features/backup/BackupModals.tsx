import { useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toast';
import { formatFileSize } from '../../domain/time';
import { downloadBlob } from '../../utils/download';
import { backupFileName, createBackup } from '../../backup/export';
import { applyBackup, readBackup } from '../../backup/import';
import type { ProgressInfo } from '../../backup/format';
import { scorePassword } from '../../backup/password';

function phaseLabel(progress: ProgressInfo | null): string {
  if (!progress) return 'Preparando…';
  switch (progress.phase) {
    case 'reading':
      return 'Leyendo datos…';
    case 'encrypting':
      return 'Cifrando…';
    case 'decrypting':
      return 'Descifrando…';
    case 'writing':
      return 'Guardando datos…';
    default:
      return 'Procesando…';
  }
}

interface ExportBackupModalProps {
  attachmentCount: number;
  attachmentSize: number;
  onClose: () => void;
  onExported: () => void;
}

export function ExportBackupModal({
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
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress(null);
    try {
      const backup = await createBackup(password, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      downloadBlob(backup, backupFileName());
      onExported();
      toast(
        `Copia creada (${formatFileSize(backup.size)}). Guárdala en un lugar seguro.`,
        'success',
      );
      onClose();
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

  return (
    <Modal
      title="Exportar copia cifrada"
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleExport()}
            disabled={busy}
          >
            {busy ? (
              <span className="spinner on-primary" />
            ) : (
              <Icon name="download" size={17} />
            )}
            Exportar
          </button>
        </>
      }
    >
      <div className="banner warning">
        <Icon name="lock" size={16} />
        <span>
          La copia incluye todos los datos y los adjuntos comprimidos. Si olvidas
          la contraseña, no se puede recuperar.
        </span>
      </div>

      {attachmentCount > 0 ? (
        <p className="field-hint">
          Se incluirán {attachmentCount}{' '}
          {attachmentCount === 1 ? 'adjunto' : 'adjuntos'} (
          {formatFileSize(attachmentSize)}).
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
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  async function handleImport() {
    setError('');
    if (!file) {
      setError('Selecciona un archivo .mhbackup.');
      return;
    }
    if (!password) {
      setError('Introduce la contraseña de la copia.');
      return;
    }
    if (!confirmed) {
      setError('Confirma que entiendes que se reemplazarán todos los datos.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress(null);
    try {
      const parsed = await readBackup(file, password, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      await applyBackup(parsed, setProgress);
      toast(
        `Copia importada: ${parsed.meta.movements.length} tramos y ${parsed.attachments.length} adjuntos.`,
        'success',
      );
      onImported();
      onClose();
    } catch (importError) {
      if ((importError as Error).name === 'AbortError') {
        toast('Importación cancelada.', 'info');
      } else {
        setError(
          (importError as Error).message || 'No se pudo importar la copia.',
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
      title="Importar copia cifrada"
      subtitle="Sustituye todos los datos actuales"
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
            disabled={busy || !file || !password || !confirmed}
          >
            {busy ? (
              <span className="spinner on-primary" />
            ) : (
              <Icon name="upload" size={17} />
            )}
            Importar
          </button>
        </>
      }
    >
      <div className="banner danger">
        <Icon name="alert" size={16} />
        <span>
          Importar una copia borra todas las cuentas, tramos y adjuntos actuales
          y los reemplaza por los de la copia. Exporta antes si quieres
          conservarlos.
        </span>
      </div>

      <div className="field">
        <span className="field-label">Archivo de copia</span>
        <label className="btn btn-secondary btn-block" style={{ cursor: 'pointer' }}>
          <Icon name="upload" size={17} />
          {file ? 'Cambiar archivo' : 'Elegir archivo .mhbackup'}
          <input
            type="file"
            accept=".mhbackup,application/octet-stream"
            className="hidden"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              event.target.value = '';
            }}
          />
        </label>
        {file ? (
          <span className="field-hint">
            {file.name} · {formatFileSize(file.size)}
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

      <label className="check-row">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          Entiendo que se reemplazarán todos los datos actuales por los de la
          copia.
        </span>
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
