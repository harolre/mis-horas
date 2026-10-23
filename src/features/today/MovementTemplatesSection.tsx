import { useState } from 'react';
import type { Account } from '../../types';
import { formatDuration, formatTime, parseTime } from '../../domain/time';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import {
  deleteMovementTemplate,
  loadMovementTemplates,
  saveMovementTemplate,
  updateMovementTemplate,
  type MovementTemplate,
} from './movementTemplates';

interface MovementTemplatesSectionProps {
  accounts: Account[];
}

export function MovementTemplatesSection({
  accounts,
}: MovementTemplatesSectionProps) {
  const [templates, setTemplates] = useState(loadMovementTemplates);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MovementTemplate | null>(
    null,
  );
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState(
    () => accounts.find((account) => !account.archived)?.id ?? '',
  );
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [breakMin, setBreakMin] = useState('0');
  const [crossesMidnight, setCrossesMidnight] = useState(false);
  const [error, setError] = useState('');

  const activeAccounts = accounts.filter((account) => !account.archived);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));

  function openEditor() {
    setEditingTemplate(null);
    setName('');
    setAccountId(activeAccounts[0]?.id ?? '');
    setStart('09:00');
    setEnd('17:00');
    setBreakMin('0');
    setCrossesMidnight(false);
    setError('');
    setEditorOpen(true);
  }

  function openTemplateEditor(template: MovementTemplate) {
    setEditingTemplate(template);
    setName(template.name);
    setAccountId(
      activeAccounts.some((account) => account.id === template.accountId)
        ? template.accountId
        : activeAccounts[0]?.id ?? '',
    );
    setStart(formatTime(template.startMin));
    setEnd(formatTime(template.endMin));
    setBreakMin(String(template.breakMin));
    setCrossesMidnight(template.crossesMidnight);
    setError('');
    setEditorOpen(true);
  }

  function createTemplate() {
    const startMin = parseTime(start);
    const endMin = parseTime(end);
    const pause = Number(breakMin);
    const gross =
      startMin !== null && endMin !== null
        ? endMin - startMin + (crossesMidnight ? 1440 : 0)
        : 0;
    if (!name.trim()) {
      setError('Escribe un nombre para la plantilla.');
      return;
    }
    if (!accountId || !activeAccounts.some((account) => account.id === accountId)) {
      setError('Selecciona una cuenta activa.');
      return;
    }
    if (startMin === null || endMin === null || gross <= 0) {
      setError('Revisa las horas. Si acaba al día siguiente, marca turno nocturno.');
      return;
    }
    if (!Number.isInteger(pause) || pause < 0 || pause >= gross) {
      setError('La pausa debe ser válida y menor que la duración del tramo.');
      return;
    }
    try {
      const values = {
        accountId,
        startMin,
        endMin,
        breakMin: pause,
        crossesMidnight,
      };
      const next = editingTemplate
        ? updateMovementTemplate(editingTemplate.id, name, values)
        : saveMovementTemplate(name, values);
      setTemplates(next);
      setEditorOpen(false);
      setEditingTemplate(null);
    } catch {
      setError('No se pudo guardar la plantilla en este dispositivo.');
    }
  }

  function removeTemplate(template: MovementTemplate) {
    try {
      setTemplates(deleteMovementTemplate(template.id));
    } catch {
      setError('No se pudo eliminar la plantilla.');
    }
  }

  return (
    <>
      <section className="card movement-templates-card" aria-label="Plantillas">
        <div className="card-header">
          <div>
            <div className="card-title">Plantillas</div>
            <div className="card-subtitle">
              Tus horarios guardados
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={openEditor}
            disabled={activeAccounts.length === 0}
          >
            <Icon name="plus" size={15} />
            Crear
          </button>
        </div>
        {templates.length > 0 ? (
          <div className="list">
            {templates.map((template) => {
              const account = accountMap.get(template.accountId);
              const duration =
                template.endMin -
                template.startMin +
                (template.crossesMidnight ? 1440 : 0) -
                template.breakMin;
              return (
                <div className="list-row" key={template.id}>
                  <span
                    className="account-dot"
                    style={{ background: account?.color ?? '#94a3b8' }}
                  />
                  <div className="list-main">
                    <div className="list-title">{template.name}</div>
                  <div className="list-subtitle">
                      {account?.name ?? 'Cuenta no disponible'} ·{' '}
                      {formatTime(template.startMin)}–
                      {formatTime(template.endMin)}
                      {template.crossesMidnight ? ' +1d' : ''} · pausa{' '}
                      {formatDuration(template.breakMin)} ·{' '}
                      {formatDuration(duration)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-button plain"
                    onClick={() => openTemplateEditor(template)}
                    aria-label={`Editar plantilla ${template.name}`}
                  >
                    <Icon name="edit" size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-button plain text-danger"
                    onClick={() => removeTemplate(template)}
                    aria-label={`Eliminar plantilla ${template.name}`}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="movement-templates-empty">
            <p className="empty-text">Todavía no has creado plantillas.</p>
            {activeAccounts.length === 0 ? (
              <p className="field-hint">
                Crea una cuenta para poder añadir una plantilla.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {editorOpen ? (
        <Modal
          title={editingTemplate ? 'Editar plantilla' : 'Nueva plantilla'}
          subtitle={
            editingTemplate
              ? 'Modifica los datos de este horario.'
              : 'Guarda un horario frecuente para reutilizarlo.'
          }
          onClose={() => {
            setEditorOpen(false);
            setEditingTemplate(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setEditorOpen(false);
                  setEditingTemplate(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={createTemplate}
              >
                <Icon name="check" size={16} />
                {editingTemplate ? 'Guardar cambios' : 'Guardar plantilla'}
              </button>
            </>
          }
        >
          <div className="form-grid movement-template-form">
            <div className="field full">
              <label className="field-label" htmlFor="template-name">
                Nombre
              </label>
              <input
                id="template-name"
                className="input"
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. Jornada habitual"
                autoFocus
              />
            </div>
            <div className="field full">
              <label className="field-label" htmlFor="template-account">
                Cuenta
              </label>
              <select
                id="template-account"
                className="select"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="template-start">
                Inicio
              </label>
              <input
                id="template-start"
                className="input"
                type="time"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="template-end">
                Fin
              </label>
              <input
                id="template-end"
                className="input"
                type="time"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </div>
            <div className="field full">
              <label className="field-label" htmlFor="template-break">
                Pausa (minutos)
              </label>
              <input
                id="template-break"
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
            <label className="check-row full">
              <input
                type="checkbox"
                checked={crossesMidnight}
                onChange={(event) => setCrossesMidnight(event.target.checked)}
              />
              <span>El tramo termina al día siguiente</span>
            </label>
            {error ? (
              <div className="banner danger full" role="alert">
                <Icon name="alert" size={16} />
                <span>{error}</span>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
