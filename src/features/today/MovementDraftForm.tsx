import { useEffect, useRef, useState } from 'react';
import type { Account } from '../../types';
import {
  formatDuration,
  formatTime,
  movementsOverlap,
  parseTime,
} from '../../domain/time';
import { Icon } from '../../components/Icon';
import type { DraftMovement } from './dayDraft';

interface MovementDraftFormProps {
  accounts: Account[];
  movements: DraftMovement[];
  editing?: DraftMovement | null;
  onSubmit: (movement: DraftMovement) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function lastAccountId(): string {
  try {
    return localStorage.getItem('mis-horas-last-account') ?? '';
  } catch {
    return '';
  }
}

export function MovementDraftForm({
  accounts,
  movements,
  editing,
  onSubmit,
  onCancel,
  onDirtyChange,
}: MovementDraftFormProps) {
  const formRef = useRef<HTMLDivElement | null>(null);
  const usableAccounts = accounts.filter(
    (account) => !account.archived || account.id === editing?.accountId,
  );
  const remembered = lastAccountId();
  const initialAccount =
    editing?.accountId ??
    (usableAccounts.some((account) => account.id === remembered)
      ? remembered
      : usableAccounts[0]?.id ?? '');
  const initialStart = editing ? formatTime(editing.startMin) : '09:00';
  const initialEnd = editing ? formatTime(editing.endMin) : '17:00';
  const initialBreak = String(editing?.breakMin ?? 0);
  const initialCrossesMidnight = editing?.crossesMidnight ?? false;
  const initialNote = editing?.note ?? '';

  const [accountId, setAccountId] = useState(initialAccount);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [breakMin, setBreakMin] = useState(initialBreak);
  const [crossesMidnight, setCrossesMidnight] = useState(
    initialCrossesMidnight,
  );
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState('');
  const formDirty =
    accountId !== initialAccount ||
    start !== initialStart ||
    end !== initialEnd ||
    breakMin !== initialBreak ||
    crossesMidnight !== initialCrossesMidnight ||
    note !== initialNote;

  const startMin = parseTime(start);
  const endMin = parseTime(end);
  const breakValue = Number(breakMin);
  const gross =
    startMin !== null && endMin !== null
      ? endMin - startMin + (crossesMidnight ? 1440 : 0)
      : 0;
  const duration = gross - (Number.isFinite(breakValue) ? breakValue : 0);
  const overlaps =
    startMin !== null && endMin !== null && gross > 0
      ? movements.filter(
          (movement) =>
            movement.key !== editing?.key &&
            movementsOverlap(
              {
                startMin: movement.startMin,
                endMin: movement.endMin,
                breakMin: movement.breakMin,
                crossesMidnight: movement.crossesMidnight ? 1 : 0,
              },
              {
                startMin,
                endMin,
                breakMin: Number.isFinite(breakValue) ? breakValue : 0,
                crossesMidnight: crossesMidnight ? 1 : 0,
              },
            ),
        )
      : [];

  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    onDirtyChange?.(formDirty);
  }, [formDirty, onDirtyChange]);

  function handleSubmit() {
    setError('');
    if (!accountId) {
      setError('Crea una cuenta antes de registrar horas.');
      return;
    }
    if (startMin === null || endMin === null) {
      setError('Introduce horas válidas.');
      return;
    }
    if (!Number.isInteger(breakValue) || breakValue < 0) {
      setError('La pausa debe ser un número entero de minutos.');
      return;
    }
    if (gross <= 0) {
      setError(
        'La hora de fin debe ser posterior al inicio. Si terminas al día siguiente, marca la casilla.',
      );
      return;
    }
    if (breakValue >= gross) {
      setError('La pausa no puede ser igual o mayor que el tramo.');
      return;
    }

    try {
      localStorage.setItem('mis-horas-last-account', accountId);
    } catch {
      // sin almacenamiento auxiliar
    }

    onSubmit({
      key: editing?.key ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      id: editing?.id,
      accountId,
      startMin,
      endMin,
      breakMin: breakValue,
      crossesMidnight,
      note: note.trim() || undefined,
    });
  }

  return (
    <div className="movement-draft-form" ref={formRef}>
      <div className="movement-draft-head">
        <div className="card-title">
          {editing ? 'Editar tramo' : 'Nuevo tramo'}
        </div>
        <span className="badge">Borrador</span>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="draft-movement-account">
          Cuenta
        </label>
        <select
          id="draft-movement-account"
          className="select"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          {usableAccounts.length === 0 ? (
            <option value="">Sin cuentas disponibles</option>
          ) : null}
          {usableAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
              {account.archived ? ' (archivada)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor="draft-movement-start">
            Inicio
          </label>
          <input
            id="draft-movement-start"
            className="input"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="draft-movement-end">
            Fin
          </label>
          <input
            id="draft-movement-end"
            className="input"
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="draft-movement-break">
            Pausa (min)
          </label>
          <input
            id="draft-movement-break"
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={1439}
            step={1}
            value={breakMin}
            onChange={(event) => setBreakMin(event.target.value)}
          />
        </div>
        <div className="field">
          <span className="field-label">Duración</span>
          <div className="input movement-duration-preview">
            {duration > 0 ? formatDuration(duration) : '—'}
          </div>
        </div>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={crossesMidnight}
          onChange={(event) => setCrossesMidnight(event.target.checked)}
        />
        <span>El turno termina al día siguiente (turno nocturno)</span>
      </label>

      {overlaps.length > 0 ? (
        <div className="banner warning">
          <Icon name="alert" size={16} />
          <span>
            Se solapa con {overlaps.length === 1 ? 'otro tramo' : 'otros tramos'} de
            este día. Puedes guardarlo igualmente.
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="draft-movement-note">
          Nota (opcional)
        </label>
        <textarea
          id="draft-movement-note"
          className="textarea"
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Ej. jornada partida, incidencia…"
        />
      </div>

      <div className="movement-draft-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={usableAccounts.length === 0}
        >
          <Icon name={editing ? 'check' : 'plus'} size={16} />
          {editing ? 'Actualizar tramo' : 'Añadir tramo'}
        </button>
      </div>
      <p className="field-hint">
        El tramo se guardará en el día al pulsar «Guardar día».
      </p>
    </div>
  );
}
