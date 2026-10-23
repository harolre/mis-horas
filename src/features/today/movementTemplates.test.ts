import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteMovementTemplate,
  loadMovementTemplates,
  saveMovementTemplate,
  updateMovementTemplate,
} from './movementTemplates';

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('plantillas de tramos', () => {
  it('guarda, carga y elimina plantillas del almacenamiento local', () => {
    mockLocalStorage();
    const values = {
      accountId: 'account-1',
      startMin: 9 * 60,
      endMin: 17 * 60,
      breakMin: 30,
      crossesMidnight: false,
    };

    const saved = saveMovementTemplate('Turno normal', values);
    expect(loadMovementTemplates()).toEqual(saved);
    expect(saved[0]).toMatchObject({ name: 'Turno normal', ...values });

    expect(deleteMovementTemplate(saved[0].id)).toEqual([]);
    expect(loadMovementTemplates()).toEqual([]);
  });

  it('ignora datos dañados del almacenamiento local', () => {
    mockLocalStorage();
    localStorage.setItem('mis-horas-movement-templates', '{mal json');

    expect(loadMovementTemplates()).toEqual([]);
  });

  it('descarta notas de plantillas antiguas al cargarlas', () => {
    mockLocalStorage();
    localStorage.setItem(
      'mis-horas-movement-templates',
      JSON.stringify([
        {
          id: 'legacy',
          name: 'Turno antiguo',
          accountId: 'account-1',
          startMin: 540,
          endMin: 1020,
          breakMin: 30,
          crossesMidnight: false,
          note: 'Esta nota ya no pertenece a la plantilla',
        },
      ]),
    );

    expect(loadMovementTemplates()[0]).not.toHaveProperty('note');
  });

  it('actualiza los datos de una plantilla conservando su identificador', () => {
    mockLocalStorage();
    const saved = saveMovementTemplate('Turno normal', {
      accountId: 'account-1',
      startMin: 540,
      endMin: 1020,
      breakMin: 30,
      crossesMidnight: false,
    });
    const updated = updateMovementTemplate(saved[0].id, 'Turno corto', {
      accountId: 'account-2',
      startMin: 600,
      endMin: 900,
      breakMin: 15,
      crossesMidnight: false,
    });

    expect(updated).toEqual([
      {
        id: saved[0].id,
        name: 'Turno corto',
        accountId: 'account-2',
        startMin: 600,
        endMin: 900,
        breakMin: 15,
        crossesMidnight: false,
      },
    ]);
    expect(loadMovementTemplates()).toEqual(updated);
  });
});
