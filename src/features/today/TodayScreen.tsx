import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Account, Attachment, DayKind, Movement } from '../../types';
import {
  addAttachment,
  attachmentStats,
  deleteAttachment,
  deleteDayData,
  deleteMovement,
  getDay,
  getSettings,
  listAccounts,
  listAttachments,
  listMovementsByDate,
  listMovementsRange,
  setDayKind,
  setDayNote,
} from '../../db/repos';
import {
  addDays,
  formatLongDate,
  startOfWeek,
  todayISO,
} from '../../domain/date';
import {
  durationMinutes,
  formatCompactDuration,
  formatDuration,
  formatFileSize,
  formatTime,
} from '../../domain/time';
import { targetForDate, weekTotals } from '../../domain/totals';
import { checkTotalLimit, prepareAttachment } from '../../attachments/process';
import type { AttachmentProgress } from '../../attachments/process';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../components/Icon';
import { ProgressBar } from '../../components/ProgressBar';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { AttachmentThumb } from '../attachments/AttachmentThumb';
import { AttachmentPreviewModal } from '../attachments/AttachmentPreviewModal';
import { MovementFormModal } from './MovementFormModal';

interface TodayScreenProps {
  date: string;
  onDateChange: (date: string) => void;
  onOpenSummary: () => void;
}

const DAY_KINDS: Array<{
  value: DayKind;
  label: string;
  chipClass: string;
  description: string;
}> = [
  { value: 'work', label: 'Trabajo', chipClass: '', description: 'Día laborable' },
  {
    value: 'vacation',
    label: 'Vacaciones',
    chipClass: 'vacation',
    description: 'Vacaciones',
  },
  {
    value: 'holiday',
    label: 'Festivo',
    chipClass: 'holiday',
    description: 'Festivo',
  },
  { value: 'sick', label: 'Baja', chipClass: 'sick', description: 'Baja' },
];

function kindInfo(kind: DayKind) {
  return DAY_KINDS.find((item) => item.value === kind) ?? DAY_KINDS[0];
}

interface ProcessingState {
  name: string;
  percent: number;
  stage: string;
  detail?: string;
}

export function TodayScreen({
  date,
  onDateChange,
  onOpenSummary,
}: TodayScreenProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const movements = useLiveQuery(
    () => listMovementsByDate(date),
    [date],
    [] as Movement[],
  );
  const accounts = useLiveQuery(
    () => listAccounts(true),
    [],
    [] as Account[],
  );
  const day = useLiveQuery(() => getDay(date), [date], undefined);
  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const attachments = useLiveQuery(
    () => listAttachments(date),
    [date],
    [] as Attachment[],
  );
  const week = useLiveQuery(
    async () => {
      if (!settings) return null;
      const start = startOfWeek(date, settings.weekStart);
      const list = await listMovementsRange(start, addDays(start, 6));
      return weekTotals(date, list, settings);
    },
    [date, settings],
    null,
  );

  const [noteDraft, setNoteDraft] = useState('');
  const [form, setForm] = useState<{ movement?: Movement } | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [deleteMovementTarget, setDeleteMovementTarget] =
    useState<Movement | null>(null);
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] =
    useState<Attachment | null>(null);
  const [deleteDayOpen, setDeleteDayOpen] = useState(false);
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState<ProcessingState | null>(null);

  useEffect(() => {
    setNoteDraft(day?.note ?? '');
  }, [date, day?.note]);

  const dayKind: DayKind = day?.kind ?? 'work';
  const info = kindInfo(dayKind);
  const activeAccounts = accounts.filter((account) => !account.archived);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const worked = movements.reduce(
    (total, movement) => total + durationMinutes(movement),
    0,
  );
  const target = settings ? targetForDate(date, settings) : 0;
  const isToday = date === todayISO();
  const hasData =
    movements.length > 0 || Boolean(day) || attachments.length > 0;

  function shiftDay(amount: number) {
    onDateChange(addDays(date, amount));
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

  async function changeKind(kind: DayKind) {
    if (kind === dayKind) return;
    if (kind !== 'work' && movements.length > 0) {
      toast('Borra los tramos antes de marcar una ausencia.', 'error');
      return;
    }
    try {
      if (kind === 'work' && !day?.note && attachments.length === 0) {
        await deleteDayData(date, false);
      } else {
        await setDayKind(date, kind, day?.note);
      }
      toast('Estado del día actualizado.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  async function saveNote() {
    const nextNote = noteDraft.trim();
    if (nextNote === (day?.note ?? '')) return;
    try {
      await setDayNote(date, nextNote);
      toast('Nota guardada.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  async function confirmDeleteMovement() {
    if (!deleteMovementTarget) return;
    setBusy(true);
    try {
      await deleteMovement(deleteMovementTarget.id);
      setDeleteMovementTarget(null);
      toast('Tramo eliminado.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteAttachment() {
    if (!deleteAttachmentTarget) return;
    setBusy(true);
    try {
      await deleteAttachment(deleteAttachmentTarget.id);
      setDeleteAttachmentTarget(null);
      toast('Adjunto eliminado.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteDay() {
    setBusy(true);
    try {
      await deleteDayData(date, includeAttachments);
      setDeleteDayOpen(false);
      toast(
        includeAttachments
          ? 'Día y adjuntos eliminados.'
          : 'Datos del día eliminados.',
        'success',
      );
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (list.length === 0) return;

    try {
      await navigator.storage?.persist?.();
    } catch {
      // La persistencia es una mejora, no un requisito.
    }

    for (const file of list) {
      const controller = new AbortController();
      abortRef.current = controller;
      setProcessing({ name: file.name, percent: 0, stage: 'Preparando…' });
      try {
        const prepared = await prepareAttachment(file, {
          signal: controller.signal,
          onProgress: (progress: AttachmentProgress) => {
            const stage =
              progress.stage === 'analizando'
                ? 'Analizando PDF…'
                : progress.stage === 'comprimiendo'
                  ? 'Comprimiendo…'
                  : progress.stage === 'guardando'
                    ? 'Guardando…'
                    : 'Leyendo…';
            setProcessing({
              name: file.name,
              percent: progress.percent,
              stage,
              detail: progress.detail,
            });
          },
        });
        const stats = await attachmentStats();
        const limitError = checkTotalLimit(stats.totalSize, prepared.finalSize);
        if (limitError) throw new Error(limitError);

        await addAttachment({
          date,
          name: prepared.name,
          mime: prepared.mime,
          size: prepared.finalSize,
          thumb: prepared.thumb,
          blob: prepared.blob,
        });

        const savedPercent =
          prepared.originalSize > 0
            ? Math.max(
                0,
                Math.round(
                  (1 - prepared.finalSize / prepared.originalSize) * 100,
                ),
              )
            : 0;
        const suffix =
          prepared.compression === 'pdf-sin-perdida'
            ? ' · PDF sin pérdida'
            : prepared.compression === 'pdf-rasterizado'
              ? ' · PDF rasterizado'
              : prepared.compression === 'original'
                ? ' · original'
                : '';
        toast(
          `${prepared.name}: ${formatFileSize(prepared.originalSize)} → ${formatFileSize(
            prepared.finalSize,
          )} (−${savedPercent} %)${suffix}`,
          'success',
        );
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          toast('Procesamiento cancelado.', 'info');
          break;
        }
        toast(
          (error as Error).message || 'No se pudo procesar el archivo.',
          'error',
        );
      }
    }
    setProcessing(null);
    abortRef.current = null;
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
        title={isToday ? 'Hoy' : 'Día'}
        subtitle={formatLongDate(date)}
        actions={
          <>
            {!isToday ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onDateChange(todayISO())}
              >
                Hoy
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button"
              onClick={() => shiftDay(-1)}
              aria-label="Día anterior"
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
              onClick={() => shiftDay(1)}
              aria-label="Día siguiente"
            >
              <Icon name="chevron-right" size={19} />
            </button>
          </>
        }
      />

      <section className="hero" aria-label="Resumen del día">
        <div className="row-between">
          <span className="hero-label">Total del día</span>
          <span className="hero-pill">
            <Icon name="clock" size={13} />
            {info.description}
          </span>
        </div>
        <div className="hero-value">{formatDuration(worked)}</div>
        <div className="hero-meta">
          {target > 0 ? (
            <>
              <span>Objetivo {formatDuration(target)}</span>
              <span>
                {worked >= target
                  ? `+${formatDuration(worked - target)}`
                  : `Faltan ${formatDuration(target - worked)}`}
              </span>
            </>
          ) : (
            <span>Sin objetivo para este día</span>
          )}
        </div>
        <div className="hero-footer">
          <ProgressBar value={target > 0 ? worked / target : 0} />
        </div>
      </section>

      {dayKind !== 'work' ? (
        <div className="banner warning">
          <Icon name="info" size={16} />
          <span>
            Día marcado como <strong>{info.label.toLowerCase()}</strong>. Es
            informativo: no altera los totales y no admite tramos de trabajo.
          </span>
        </div>
      ) : null}

      {week ? (
        <button
          type="button"
          className="week-strip"
          onClick={onOpenSummary}
          aria-label="Ver resumen de la semana"
        >
          <span className="week-strip-text">Semana</span>
          <ProgressBar
            value={week.target > 0 ? week.worked / week.target : 0}
          />
          <span className="week-strip-text">
            {formatCompactDuration(week.worked)} /{' '}
            {formatCompactDuration(week.target)}
          </span>
          {week.extra > 0 ? (
            <span className="badge warning">+{formatDuration(week.extra)}</span>
          ) : null}
          <Icon name="chevron-right" size={15} />
        </button>
      ) : null}

      <section className="card card-pad stack-sm">
        <div className="day-status-row">
          <span className="day-status-label">Estado del día</span>
          <span className="badge">{info.description}</span>
        </div>
        <div className="chip-row">
          {DAY_KINDS.map((kind) => (
            <button
              key={kind.value}
              type="button"
              className={`chip ${kind.chipClass}`}
              aria-pressed={dayKind === kind.value}
              onClick={() => void changeKind(kind.value)}
            >
              {kind.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Tramos</div>
            <div className="card-subtitle">
              {movements.length === 0
                ? 'Sin registros'
                : `${movements.length} ${
                    movements.length === 1 ? 'tramo' : 'tramos'
                  } · ${formatDuration(worked)}`}
            </div>
          </div>
          {dayKind === 'work' ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setForm({})}
              disabled={activeAccounts.length === 0}
            >
              <Icon name="plus" size={16} />
              Añadir
            </button>
          ) : null}
        </div>

        {movements.length === 0 ? (
          <EmptyState
            icon="clock"
            title={dayKind === 'work' ? 'Sin horas todavía' : info.label}
            text={
              dayKind === 'work'
                ? 'Añade un tramo para empezar a registrar el día.'
                : 'Este día no admite tramos de trabajo.'
            }
            action={
              dayKind === 'work' && activeAccounts.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setForm({})}
                >
                  <Icon name="plus" size={16} />
                  Añadir tramo
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="list">
            {movements.map((movement) => {
              const account = accountMap.get(movement.accountId);
              return (
                <div className="movement-row" key={movement.id}>
                  <button
                    type="button"
                    className="movement-button"
                    onClick={() => setForm({ movement })}
                    aria-label={`Editar tramo de ${formatTime(
                      movement.startMin,
                    )} a ${formatTime(movement.endMin)}`}
                  >
                    <span
                      className="account-dot"
                      style={{ background: account?.color ?? '#94a3b8' }}
                    />
                    <span className="movement-info">
                      <span className="movement-time">
                        {formatTime(movement.startMin)} –{' '}
                        {formatTime(movement.endMin)}
                        {movement.crossesMidnight ? ' +1d' : ''}
                      </span>
                      <span className="movement-account">
                        {account?.name ?? 'Cuenta eliminada'}
                      </span>
                      {movement.note ? (
                        <span className="movement-note">{movement.note}</span>
                      ) : null}
                    </span>
                    <span className="movement-duration">
                      {formatDuration(durationMinutes(movement))}
                    </span>
                  </button>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-button plain"
                      onClick={() => setForm({ movement })}
                      aria-label="Editar tramo"
                    >
                      <Icon name="edit" size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button plain text-danger"
                      onClick={() => setDeleteMovementTarget(movement)}
                      aria-label="Eliminar tramo"
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {activeAccounts.length === 0 ? (
        <div className="banner warning">
          <Icon name="alert" size={16} />
          <span>
            No hay cuentas activas. Crea una o desarchiva alguna desde la
            pestaña Cuentas.
          </span>
        </div>
      ) : null}

      <section className="card card-pad stack-sm">
        <div className="attachment-section-head">
          <span className="section-title">Adjuntos</span>
          <span className="badge">
            {attachments.length}{' '}
            {attachments.length === 1 ? 'archivo' : 'archivos'}
          </span>
        </div>

        {processing ? (
          <div className="processing-card">
            <div className="processing-head">
              <span className="row-center" style={{ minWidth: 0 }}>
                <span className="spinner" />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {processing.name}
                </span>
              </span>
              <span>{Math.round(processing.percent * 100)} %</span>
            </div>
            <div className="progress">
              <div
                className="progress-bar"
                style={{ width: `${Math.round(processing.percent * 100)}%` }}
              />
            </div>
            <div className="row-between">
              <span className="tiny muted">
                {processing.detail ?? processing.stage}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => abortRef.current?.abort()}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        <div className="attach-grid">
          {attachments.map((attachment) => (
            <div className="attach-card" key={attachment.id}>
              <button
                type="button"
                style={{ width: '100%', height: '100%', padding: 0 }}
                onClick={() => setPreview(attachment)}
                aria-label={`Abrir ${attachment.name}`}
              >
                <AttachmentThumb attachment={attachment} />
                <span className="attach-overlay">{attachment.name}</span>
              </button>
              <button
                type="button"
                className="attach-delete"
                onClick={() => setDeleteAttachmentTarget(attachment)}
                aria-label={`Eliminar ${attachment.name}`}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="attach-card attach-add"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(processing)}
          >
            <Icon name="plus" size={23} />
            <span>Añadir</span>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <p className="field-hint">
          Imágenes y PDF. Máximo 25 MB de entrada, 10 MB por archivo y 100 MB en
          total. Las imágenes se recomprimen y los PDF se optimizan.
        </p>
      </section>

      <section className="card card-pad stack-sm">
        <label className="field-label" htmlFor="day-note">
          Nota del día
        </label>
        <textarea
          id="day-note"
          className="textarea"
          value={noteDraft}
          maxLength={800}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={() => void saveNote()}
          placeholder="Ej. incidencia, tarea principal, incidencias…"
        />
        <span className="field-hint">Se guarda al salir del campo.</span>
      </section>

      {hasData ? (
        <button
          type="button"
          className="btn btn-ghost btn-block text-danger"
          onClick={() => {
            setIncludeAttachments(false);
            setDeleteDayOpen(true);
          }}
        >
          <Icon name="trash" size={16} />
          Borrar datos del día
        </button>
      ) : null}

      {form ? (
        <MovementFormModal
          date={date}
          accounts={accounts}
          movement={form.movement}
          onClose={() => setForm(null)}
          onSaved={(message) => toast(message, 'success')}
        />
      ) : null}

      {preview ? (
        <AttachmentPreviewModal
          attachment={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {deleteMovementTarget ? (
        <ConfirmDialog
          title="Eliminar tramo"
          message={`Se eliminará el tramo de ${formatTime(
            deleteMovementTarget.startMin,
          )} a ${formatTime(deleteMovementTarget.endMin)} (${formatDuration(
            durationMinutes(deleteMovementTarget),
          )}).`}
          confirmLabel="Eliminar"
          danger
          busy={busy}
          onConfirm={() => void confirmDeleteMovement()}
          onClose={() => setDeleteMovementTarget(null)}
        />
      ) : null}

      {deleteAttachmentTarget ? (
        <ConfirmDialog
          title="Eliminar adjunto"
          message={`Se eliminará «${deleteAttachmentTarget.name}». Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          danger
          busy={busy}
          onConfirm={() => void confirmDeleteAttachment()}
          onClose={() => setDeleteAttachmentTarget(null)}
        />
      ) : null}

      {deleteDayOpen ? (
        <ConfirmDialog
          title="Borrar datos del día"
          message="Se eliminarán los tramos, la nota y el estado del día. Los adjuntos se conservan salvo que marques la casilla."
          confirmLabel="Borrar día"
          danger
          busy={busy}
          onConfirm={() => void confirmDeleteDay()}
          onClose={() => setDeleteDayOpen(false)}
        >
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeAttachments}
              onChange={(event) => setIncludeAttachments(event.target.checked)}
            />
            <span>Eliminar también los adjuntos de este día</span>
          </label>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
