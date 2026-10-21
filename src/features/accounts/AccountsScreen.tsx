import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Account, Movement } from '../../types';
import {
  allMovements,
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from '../../db/repos';
import { ACCOUNT_COLORS } from '../../db/defaults';
import {
  endOfMonth,
  formatMonthYear,
  startOfMonth,
  todayISO,
} from '../../domain/date';
import { durationMinutes, formatDuration } from '../../domain/time';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../components/Icon';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/Toast';

interface AccountFormProps {
  account?: Account;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function AccountFormModal({ account, onClose, onSaved }: AccountFormProps) {
  const [name, setName] = useState(account?.name ?? '');
  const [color, setColor] = useState(account?.color ?? ACCOUNT_COLORS[0]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError('');
    if (!name.trim()) {
      setError('Escribe un nombre para la cuenta.');
      return;
    }
    setSaving(true);
    try {
      if (account) {
        await updateAccount(account.id, { name, color });
        onSaved('Cuenta actualizada.');
      } else {
        await createAccount(name, color);
        onSaved('Cuenta creada.');
      }
      onClose();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={account ? 'Editar cuenta' : 'Nueva cuenta'}
      subtitle="Las cuentas solo organizan tus horas; no cambian los objetivos."
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
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? <span className="spinner on-primary" /> : null}
            Guardar
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="account-name">
          Nombre
        </label>
        <input
          id="account-name"
          className="input"
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ej. Cliente A, Proyecto web…"
          autoFocus
        />
      </div>

      <div className="field">
        <span className="field-label">Color</span>
        <div className="color-grid" role="group" aria-label="Color de la cuenta">
          {ACCOUNT_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              className={`color-option ${color === option ? 'selected' : ''}`}
              style={{ background: option }}
              onClick={() => setColor(option)}
              aria-label={`Color ${option}`}
              aria-pressed={color === option}
            />
          ))}
        </div>
      </div>

      {error ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}

export function AccountsScreen() {
  const toast = useToast();
  const accounts = useLiveQuery(
    () => listAccounts(true),
    [],
    [] as Account[],
  );
  const movements = useLiveQuery(
    () => allMovements(),
    [],
    [] as Movement[],
  );
  const [form, setForm] = useState<{ account?: Account } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);

  const monthFrom = startOfMonth(todayISO());
  const monthTo = endOfMonth(todayISO());
  const totalByAccount = new Map<string, number>();
  const monthByAccount = new Map<string, number>();
  for (const movement of movements) {
    const minutes = durationMinutes(movement);
    totalByAccount.set(
      movement.accountId,
      (totalByAccount.get(movement.accountId) ?? 0) + minutes,
    );
    if (movement.date >= monthFrom && movement.date <= monthTo) {
      monthByAccount.set(
        movement.accountId,
        (monthByAccount.get(movement.accountId) ?? 0) + minutes,
      );
    }
  }

  const activeAccounts = accounts.filter((account) => !account.archived);
  const archivedAccounts = accounts.filter((account) => account.archived);

  async function toggleArchive(account: Account) {
    const archiving = !account.archived;
    if (archiving && activeAccounts.length <= 1) {
      toast('Debe quedar al menos una cuenta activa.', 'error');
      return;
    }
    try {
      await updateAccount(account.id, { archived: archiving ? 1 : 0 });
      toast(archiving ? 'Cuenta archivada.' : 'Cuenta reactivada.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  }

  function requestDelete(account: Account) {
    const total = totalByAccount.get(account.id) ?? 0;
    if (total > 0) {
      toast(
        'La cuenta tiene movimientos. Archívala si ya no la usas.',
        'error',
      );
      return;
    }
    setDeleteTarget(account);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteAccount(deleteTarget.id);
      setDeleteTarget(null);
      toast('Cuenta eliminada.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function renderAccount(account: Account) {
    const monthMinutes = monthByAccount.get(account.id) ?? 0;
    const totalMinutes = totalByAccount.get(account.id) ?? 0;
    return (
      <div className="list-row" key={account.id}>
        <span
          className="account-avatar"
          style={{ background: account.color }}
          aria-hidden="true"
        >
          {account.name.charAt(0).toUpperCase()}
        </span>
        <div className="list-main">
          <div className="row-center" style={{ gap: 6 }}>
            <span className="list-title">{account.name}</span>
            {account.archived ? (
              <span className="badge">Archivada</span>
            ) : null}
          </div>
          <div className="list-subtitle">
            Este mes {formatDuration(monthMinutes)} · Total{' '}
            {formatDuration(totalMinutes)}
          </div>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="icon-button plain"
            onClick={() => setForm({ account })}
            aria-label={`Editar ${account.name}`}
          >
            <Icon name="edit" size={17} />
          </button>
          <button
            type="button"
            className="icon-button plain"
            onClick={() => void toggleArchive(account)}
            aria-label={
              account.archived
                ? `Reactivar ${account.name}`
                : `Archivar ${account.name}`
            }
          >
            <Icon name={account.archived ? 'refresh' : 'archive'} size={17} />
          </button>
          <button
            type="button"
            className="icon-button plain text-danger"
            onClick={() => requestDelete(account)}
            aria-label={`Eliminar ${account.name}`}
          >
            <Icon name="trash" size={17} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="Cuentas"
        subtitle="Organiza tus horas por cliente o proyecto"
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setForm({})}
          >
            <Icon name="plus" size={16} />
            Nueva
          </button>
        }
      />

      <div className="banner">
        <Icon name="info" size={16} />
        <span>
          Las cuentas son etiquetas organizativas. El objetivo y el extra se
          calculan siempre sobre el total global de horas.
        </span>
      </div>

      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Cuentas activas</div>
            <div className="card-subtitle">
              {formatMonthYear(todayISO())}
            </div>
          </div>
        </div>
        {activeAccounts.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title="No hay cuentas activas"
            text="Crea una cuenta para poder registrar tramos de trabajo."
            action={
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setForm({})}
              >
                <Icon name="plus" size={16} />
                Crear cuenta
              </button>
            }
          />
        ) : (
          <div className="list">{activeAccounts.map(renderAccount)}</div>
        )}
      </section>

      {archivedAccounts.length > 0 ? (
        <section className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Archivadas</div>
              <div className="card-subtitle">
                No aparecen al registrar horas
              </div>
            </div>
          </div>
          <div className="list">{archivedAccounts.map(renderAccount)}</div>
        </section>
      ) : null}

      {form ? (
        <AccountFormModal
          account={form.account}
          onClose={() => setForm(null)}
          onSaved={(message) => toast(message, 'success')}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Eliminar cuenta"
          message={`¿Eliminar «${deleteTarget.name}»? Solo es posible si no tiene movimientos asociados.`}
          confirmLabel="Eliminar"
          danger
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}
