import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Account, Movement } from '../../types';
import {
  addMovement,
  findOverlaps,
  listMovementsByDate,
  updateMovement,
} from '../../db/repos';
import { formatTime, parseTime, formatDuration } from '../../domain/time';
import { Modal } from '../../components/Modal';
import { Icon } from '../../components/Icon';

interface MovementFormModalProps {
  date: string;
  accounts: Account[];
  movement?: Movement;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function lastAccountId(): string {
  try {
    return localStorage.getItem('mis-horas-last-account') ?? '';
  } catch {
    return '';
  }
}

export function MovementFormModal({
  date,
  accounts,
  movement,
  onClose,
  onSaved,
}: MovementFormModalProps) {
  const dayMovements = useLiveQuery(
    () => listMovementsByDate(date),
    [date],
    [],
  );
  const usableAccounts = accounts.filter(
    (account) => !account.archived || account.id === movement?.accountId,
  );
  const remembered = lastAccountId();
  const initialAccount =
    movement?.accountId ??
    (usableAccounts.some((account) => account.id === remembered)
      ? remembered
      : usableAccounts[0]?.id ?? '');

  const [accountId, setAccountId] = useState(initialAccount);
  const [start, setStart] = useState(
    movement ? formatTime(movement.startMin) : '09:00',
  );
  const [end, setEnd] = useState(
    movement ? formatTime(movement.endMin) : '17:00',
  );
  const [breakMin, setBreakMin] = useState(String(movement?.breakMin ?? 0));
  const [crossesMidnight, setCrossesMidnight] = useState(
    movement?.crossesMidnight === 1,
  );
  const [note, setNote] = useState(movement?.note ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
      ? findOverlaps(
          {
            accountId,
            date,
            startMin,
            endMin,
            breakMin: Number.isFinite(breakValue) ? breakValue : 0,
            crossesMidnight,
          },
          dayMovements,
          movement?.id,
        )
      : [];

  async function handleSubmit() {
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
    setSaving(true);
    try {
      const input = {
        accountId,
        date,
        startMin,
        endMin,
        breakMin: breakValue,
        crossesMidnight,
        note,
      };
      if (movement) {
        await updateMovement(movement.id, input);
        onSaved('Tramo actualizado.');
      } else {
        await addMovement(input);
        onSaved('Tramo añadido.');
      }
      try {
        localStorage.setItem('mis-horas-last-account', accountId);
      } catch {
        // sin almacenamiento auxiliar
      }
      onClose();
    } catch (submitError) {
      setError((submitError as Error).message || 'No se pudo guardar el tramo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={movement ? 'Editar tramo' : 'Nuevo tramo'}
      subtitle={date}
      onClose={onClose}
      dismissible={!saving}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSubmit()}
            disabled={saving}
          >
            {saving ? <span className="spinner on-primary" /> : <Icon name="save" size={17} />}
            Guardar
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="movement-account">
          Cuenta
        </label>
        <select
          id="movement-account"
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
          <label className="field-label" htmlFor="movement-start">
            Inicio
          </label>
          <input
            id="movement-start"
            className="input"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="movement-end">
            Fin
          </label>
          <input
            id="movement-end"
            className="input"
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="movement-break">
            Pausa (min)
          </label>
          <input
            id="movement-break"
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
          <div
            className="input"
            style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}
          >
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
        <label className="field-label" htmlFor="movement-note">
          Nota (opcional)
        </label>
        <textarea
          id="movement-note"
          className="textarea"
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Ej. jornada partida, incidencia…"
        />
      </div>
    </Modal>
  );
}
