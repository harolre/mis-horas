import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Account,
  Attachment,
  DayEntry,
  DayKind,
  ISODate,
  Movement,
} from '../../types';
import {
  listAttachments,
  saveDayDraft,
} from '../../db/repos';
import { binaryToBlob } from '../../db/binary';
import { formatLongDate } from '../../domain/date';
import { formatDuration, formatTime } from '../../domain/time';
import { prepareAttachment } from '../../attachments/process';
import type { AttachmentProgress } from '../../attachments/process';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { AttachmentThumb } from '../attachments/AttachmentThumb';
import { AttachmentPreviewModal } from '../attachments/AttachmentPreviewModal';
import { DAY_KINDS, kindInfo } from './dayKinds';
import { MovementDraftForm } from './MovementDraftForm';
import {
  draftDuration,
  draftToInput,
  movementToDraft,
  pendingFromPrepared,
  type DraftMovement,
  type PendingAttachment,
} from './dayDraft';

interface DayEditorSheetProps {
  date: ISODate;
  target: number;
  accounts: Account[];
  initialDay?: DayEntry;
  initialMovements: Movement[];
  onClose: () => void;
}

interface ProcessingState {
  name: string;
  percent: number;
  stage: string;
  detail?: string;
}

interface PreviewTarget {
  attachment: Attachment;
  blob?: Blob | null;
}

function compareDraftMovements(a: DraftMovement, b: DraftMovement): number {
  return a.startMin - b.startMin || a.endMin - b.endMin;
}

function sameDraftMovement(a: DraftMovement, b: DraftMovement): boolean {
  return (
    a.id === b.id &&
    a.accountId === b.accountId &&
    a.startMin === b.startMin &&
    a.endMin === b.endMin &&
    a.breakMin === b.breakMin &&
    a.crossesMidnight === b.crossesMidnight &&
    (a.note ?? '') === (b.note ?? '')
  );
}

function movementsChanged(
  initial: DraftMovement[],
  current: DraftMovement[],
): boolean {
  if (initial.length !== current.length) return true;
  const byKey = new Map(initial.map((movement) => [movement.key, movement]));
  return current.some((movement) => {
    const original = byKey.get(movement.key);
    return !original || !sameDraftMovement(original, movement);
  });
}

export function DayEditorSheet({
  date,
  target,
  accounts,
  initialDay,
  initialMovements,
  onClose,
}: DayEditorSheetProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const [initialDrafts] = useState<DraftMovement[]>(() =>
    initialMovements.map(movementToDraft).sort(compareDraftMovements),
  );
  const [initialKind] = useState<DayKind>(initialDay?.kind ?? 'work');
  const [initialNote] = useState(initialDay?.note ?? '');

  const [kind, setKind] = useState<DayKind>(initialKind);
  const [note, setNote] = useState(initialNote);
  const [movements, setMovements] = useState<DraftMovement[]>(() =>
    initialDrafts.map((movement) => ({ ...movement })),
  );
  const [pendingAdds, setPendingAdds] = useState<PendingAttachment[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(
    () => new Set(),
  );
  const [editor, setEditor] = useState<{ movement?: DraftMovement } | null>(
    null,
  );
  const [formDirty, setFormDirty] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteDayOpen, setDeleteDayOpen] = useState(false);
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const attachments = useLiveQuery(
    () => listAttachments(date),
    [date],
    [] as Attachment[],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const activeAccounts = accounts.filter((account) => !account.archived);
  const info = kindInfo(kind);
  const worked = movements.reduce(
    (total, movement) => total + draftDuration(movement),
    0,
  );
  const excess = target > 0 ? Math.max(0, worked - target) : 0;
  const attachmentCount =
    attachments.filter((attachment) => !pendingDeletes.has(attachment.id))
      .length + pendingAdds.length;
  const attachmentSummary =
    attachments.length + pendingAdds.length === 0
      ? 'Opcional'
      : pendingAdds.length > 0 || pendingDeletes.size > 0
        ? `${attachmentCount} al guardar`
        : `${attachmentCount} ${
            attachmentCount === 1 ? 'archivo' : 'archivos'
          }`;
  const removedCount = initialDrafts.filter(
    (movement) =>
      !movements.some((current) => current.key === movement.key),
  ).length;
  const movementsDirty = movementsChanged(initialDrafts, movements);
  const dirty =
    kind !== initialKind ||
    note !== initialNote ||
    movementsDirty ||
    pendingAdds.length > 0 ||
    pendingDeletes.size > 0 ||
    formDirty ||
    Boolean(processing);
  const hasData =
    movements.length > 0 ||
    Boolean(note.trim()) ||
    kind !== 'work' ||
    attachments.length > 0 ||
    pendingAdds.length > 0;

  function closeEditor() {
    setEditor(null);
    setFormDirty(false);
  }

  function changeKind(nextKind: DayKind) {
    if (nextKind === kind) return;
    if (nextKind !== 'work' && (movements.length > 0 || editor)) {
      toast(
        'Quita los tramos y termina el formulario antes de marcar una ausencia.',
        'error',
      );
      return;
    }
    setKind(nextKind);
  }

  function submitDraftMovement(movement: DraftMovement) {
    const editingKey = editor?.movement?.key;
    setMovements((current) => {
      const next = editingKey
        ? current.map((item) => (item.key === editingKey ? movement : item))
        : [...current, movement];
      return next.sort(compareDraftMovements);
    });
    closeEditor();
  }

  function removeDraftMovement(movement: DraftMovement) {
    setMovements((current) =>
      current.filter((item) => item.key !== movement.key),
    );
    if (editor?.movement?.key === movement.key) closeEditor();
  }

  function toggleAttachmentDelete(id: string) {
    setPendingDeletes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removePendingAttachment(key: string) {
    setPendingAdds((current) => current.filter((item) => item.key !== key));
  }

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (list.length === 0) return;

    const firstController = new AbortController();
    abortRef.current = firstController;
    setProcessing({
      name: list[0].name,
      percent: 0,
      stage: 'Preparando…',
    });

    try {
      await navigator.storage?.persist?.();
    } catch {
      // La persistencia es una mejora, no un requisito.
    }

    if (!mountedRef.current) return;

    for (const [index, file] of list.entries()) {
      const controller = index === 0 ? firstController : new AbortController();
      abortRef.current = controller;
      if (controller.signal.aborted) {
        if (mountedRef.current) toast('Procesamiento cancelado.', 'info');
        break;
      }
      setProcessing({
        name: file.name,
        percent: 0,
        stage: 'Preparando…',
      });
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
                    ? 'Preparando…'
                    : 'Leyendo…';
            if (!mountedRef.current) return;
            setProcessing({
              name: file.name,
              percent: progress.percent,
              stage,
              detail: progress.detail,
            });
          },
        });
        if (!mountedRef.current) return;
        if (controller.signal.aborted) break;

        setPendingAdds((current) => [
          ...current,
          pendingFromPrepared(date, prepared),
        ]);

        toast('Adjunto optimizado. Se guardará al guardar el día.', 'success');
      } catch (fileError) {
        if (!mountedRef.current) break;
        if ((fileError as Error).name === 'AbortError') {
          toast('Procesamiento cancelado.', 'info');
          break;
        }
        toast(
          (fileError as Error).message || 'No se pudo procesar el archivo.',
          'error',
        );
      }
    }

    if (mountedRef.current) {
      setProcessing(null);
      abortRef.current = null;
    }
  }

  function requestClose() {
    if (saving) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }

  function discardChanges() {
    abortRef.current?.abort();
    setDiscardOpen(false);
    onClose();
  }

  function requestDeleteDay() {
    setIncludeAttachments(false);
    setDeleteDayOpen(true);
  }

  function confirmDeleteDayDraft() {
    setMovements([]);
    setKind('work');
    setNote('');
    closeEditor();
    setError('');
    if (includeAttachments) {
      abortRef.current?.abort();
      setProcessing(null);
      setPendingAdds([]);
      setPendingDeletes(new Set(attachments.map((attachment) => attachment.id)));
    }
    setDeleteDayOpen(false);
    toast(
      'Borrado preparado. Se aplicará al pulsar «Guardar día».',
      'info',
    );
  }

  async function handleSave() {
    if (saving || processing || editor) return;
    setError('');
    setSaving(true);
    try {
      await saveDayDraft({
        date,
        kind,
        note,
        movements: movements.map(draftToInput),
        removedMovementIds: initialDrafts
          .filter(
            (movement) =>
              !movements.some((current) => current.key === movement.key),
          )
          .map((movement) => movement.id)
          .filter((id): id is string => Boolean(id)),
        attachmentAdds: pendingAdds.map((pending) => ({
          name: pending.attachment.name,
          mime: pending.attachment.mime,
          size: pending.attachment.size,
          thumb: binaryToBlob(pending.attachment.thumb, 'image/jpeg'),
          blob: pending.blob,
        })),
        attachmentDeletes: Array.from(pendingDeletes),
      });
      toast(
        pendingAdds.length > 0 || pendingDeletes.size > 0
          ? 'Día y adjuntos guardados.'
          : 'Día guardado.',
        'success',
      );
      setSaving(false);
      onClose();
    } catch (saveError) {
      const errorName = (saveError as Error).name;
      const message =
        errorName === 'QuotaExceededError'
          ? 'El navegador no tiene espacio suficiente para guardar. Libera espacio del sitio o exporta una copia de seguridad e inténtalo de nuevo.'
          : (saveError as Error).message ||
            'No se pudieron guardar los cambios.';
      setSaving(false);
      setError(message);
      toast(message, 'error');
    }
  }

  return (
    <Modal
      title={formatLongDate(date)}
      subtitle="Horas y adjuntos"
      onClose={requestClose}
      dismissible={!saving}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={requestClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (dirty) void handleSave();
              else requestClose();
            }}
            disabled={saving || Boolean(processing) || Boolean(editor)}
          >
            {saving ? (
              <span className="spinner on-primary" />
            ) : (
              <Icon name={dirty ? 'save' : 'check'} size={17} />
            )}
            {saving ? 'Guardando…' : dirty ? 'Guardar día' : 'Cerrar'}
          </button>
        </>
      }
    >
      <div className="sheet-summary" aria-label="Resumen del día">
        <div className="sheet-summary-item">
          <span>Trabajado</span>
          <strong>{formatDuration(worked)}</strong>
        </div>
        <div className="sheet-summary-item">
          <span>Objetivo</span>
          <strong>{target > 0 ? formatDuration(target) : '—'}</strong>
        </div>
        <div className="sheet-summary-item">
          <span>Exceso</span>
          <strong className={excess > 0 ? 'text-warning' : undefined}>
            {excess > 0 ? `+${formatDuration(excess)}` : '—'}
          </strong>
        </div>
      </div>

      {error ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {excess > 0 ? (
        <div className="banner warning">
          <Icon name="info" size={16} />
          <span>
            Has trabajado <strong>{formatDuration(excess)}</strong> por encima
            del objetivo de este día. El extra se calcula por semana.
          </span>
        </div>
      ) : null}

      {kind !== 'work' ? (
        <div className="banner warning">
          <Icon name="info" size={16} />
          <span>
            Día marcado como <strong>{info.label.toLowerCase()}</strong>. Es
            informativo: no altera los totales y no admite tramos de trabajo.
          </span>
        </div>
      ) : null}

      <div className="sheet-section day-status-block">
        <div className="day-status-row">
          <span className="day-status-label">Estado del día</span>
          <span className={`badge ${info.chipClass}`}>{info.description}</span>
        </div>
        <div className="chip-row">
          {DAY_KINDS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`chip ${item.chipClass}`}
              aria-pressed={kind === item.value}
              onClick={() => changeKind(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-section day-movements-block">
        <div className="day-section-head">
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
          {kind === 'work' ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setEditor({})}
              disabled={activeAccounts.length === 0 || Boolean(editor)}
            >
              <Icon name="plus" size={16} />
              Añadir
            </button>
          ) : null}
        </div>

        {movements.length === 0 ? (
          editor ? null : (
            <EmptyState
              icon="clock"
              title={kind === 'work' ? 'Sin horas todavía' : info.label}
              text={
                kind === 'work'
                  ? 'Añade un tramo para empezar a registrar el día.'
                  : 'Este día no admite tramos de trabajo.'
              }
            />
          )
        ) : (
          <div className="list day-movement-list">
            {movements.map((movement) => {
              const account = accountMap.get(movement.accountId);
              return (
                <div className="movement-row" key={movement.key}>
                  <button
                    type="button"
                    className="movement-button"
                    onClick={() => setEditor({ movement })}
                    aria-label={`Editar tramo de ${formatTime(
                      movement.startMin,
                    )} a ${formatTime(movement.endMin)}`}
                  >
                    <span
                      className="account-dot"
                      style={{
                        background: account?.color ?? '#94a3b8',
                      }}
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
                      {formatDuration(draftDuration(movement))}
                    </span>
                  </button>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-button plain"
                      onClick={() => setEditor({ movement })}
                      aria-label="Editar tramo"
                    >
                      <Icon name="edit" size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button plain text-danger"
                      onClick={() => removeDraftMovement(movement)}
                      aria-label="Quitar tramo del borrador"
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {removedCount > 0 ? (
          <p className="field-hint">
            {removedCount === 1
              ? '1 tramo se eliminará al guardar.'
              : `${removedCount} tramos se eliminarán al guardar.`}
          </p>
        ) : null}

        {editor ? (
          <MovementDraftForm
            key={editor.movement?.key ?? 'new'}
            accounts={accounts}
            movements={movements}
            editing={editor.movement}
            onSubmit={submitDraftMovement}
            onCancel={closeEditor}
            onDirtyChange={setFormDirty}
          />
        ) : null}
      </div>

      <div className="sheet-section day-attachments-block">
        <div className="attachment-section-head">
          <div>
            <span className="section-title">Adjuntos</span>
            <div className="card-subtitle">{attachmentSummary}</div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(processing)}
          >
            <Icon name="paperclip" size={15} />
            Adjuntar
          </button>
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
                style={{
                  width: `${Math.round(processing.percent * 100)}%`,
                }}
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

        {attachments.length > 0 || pendingAdds.length > 0 ? (
          <div className="attach-grid">
            {attachments.map((attachment) => {
              const marked = pendingDeletes.has(attachment.id);
              return (
                <div
                  className={`attach-card ${marked ? 'pending-delete' : ''}`}
                  key={attachment.id}
                >
                  <button
                    type="button"
                    className="attach-open"
                    onClick={() => setPreview({ attachment })}
                    aria-label={`Abrir ${attachment.name}`}
                  >
                    <AttachmentThumb attachment={attachment} />
                    <span className="attach-overlay">{attachment.name}</span>
                  </button>
                  {marked ? (
                    <span className="attach-badge danger">Se eliminará</span>
                  ) : null}
                  <button
                    type="button"
                    className="attach-delete"
                    onClick={() => toggleAttachmentDelete(attachment.id)}
                    aria-label={
                      marked
                        ? `Conservar ${attachment.name}`
                        : `Eliminar ${attachment.name}`
                    }
                  >
                    <Icon name={marked ? 'refresh' : 'trash'} size={13} />
                  </button>
                </div>
              );
            })}

            {pendingAdds.map((pending) => (
              <div className="attach-card pending-add" key={pending.key}>
                <button
                  type="button"
                  className="attach-open"
                  onClick={() =>
                    setPreview({
                      attachment: pending.attachment,
                      blob: pending.blob,
                    })
                  }
                  aria-label={`Abrir ${pending.attachment.name}`}
                >
                  <AttachmentThumb attachment={pending.attachment} />
                  <span className="attach-overlay">
                    {pending.attachment.name}
                  </span>
                </button>
                <span className="attach-badge">Pendiente</span>
                <button
                  type="button"
                  className="attach-delete"
                  onClick={() => removePendingAttachment(pending.key)}
                  aria-label={`Quitar ${pending.attachment.name}`}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <p className="field-hint">
          Los adjuntos se optimizan automáticamente. Se guardan al pulsar
          «Guardar día».
        </p>
      </div>

      {hasData ? (
        <button
          type="button"
          className="btn btn-ghost btn-block text-danger"
          onClick={requestDeleteDay}
          disabled={saving}
        >
          <Icon name="trash" size={16} />
          Borrar datos del día
        </button>
      ) : null}

      {editor ? (
        <p className="field-hint sheet-save-hint">
          Termina o cancela el tramo para poder guardar el día.
        </p>
      ) : null}
      {processing ? (
        <p className="field-hint sheet-save-hint">
          Espera a que termine el adjunto o cancélalo para guardar el día.
        </p>
      ) : null}

      {preview ? (
        <AttachmentPreviewModal
          attachment={preview.attachment}
          blob={preview.blob}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {discardOpen ? (
        <ConfirmDialog
          title="Descartar cambios"
          message="Se descartarán los tramos, el estado, la nota y los adjuntos pendientes de este día. Los adjuntos ya guardados no se modificarán."
          confirmLabel="Descartar"
          cancelLabel="Seguir editando"
          danger
          onConfirm={discardChanges}
          onClose={() => setDiscardOpen(false)}
        />
      ) : null}

      {deleteDayOpen ? (
        <ConfirmDialog
          title="Borrar datos del día"
          message="Se vaciarán los tramos, la nota y el estado. Se aplicará al pulsar «Guardar día». Los adjuntos no se tocan salvo que marques la casilla."
          confirmLabel="Borrar al guardar"
          danger
          onConfirm={confirmDeleteDayDraft}
          onClose={() => setDeleteDayOpen(false)}
        >
          <label className="check-row">
            <input
              type="checkbox"
              checked={includeAttachments}
              onChange={(event) => setIncludeAttachments(event.target.checked)}
            />
            <span>Eliminar también los adjuntos de este día al guardar</span>
          </label>
        </ConfirmDialog>
      ) : null}
    </Modal>
  );
}
