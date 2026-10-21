import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { defaultAccount, defaultSettings } from './defaults';
import {
  addAttachment,
  addMovement,
  attachmentStats,
  deleteAccount,
  deleteAttachment,
  deleteDayData,
  deleteMovement,
  listAttachments,
  listMovementsByDate,
  saveDayDraft,
  setDayKind,
  updateAccount,
  ValidationError,
  cleanupAttachments,
} from './repos';
import type { Account } from '../types';

let account: Account;

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  account = defaultAccount();
  await db.accounts.put(account);
  await db.settings.put(defaultSettings());
});

afterAll(async () => {
  await db.close();
  await db.delete();
});

describe('repositorio', () => {
  it('guarda tramos y crea el día', async () => {
    const movement = await addMovement({
      accountId: account.id,
      date: '2026-10-21',
      startMin: 540,
      endMin: 1020,
      breakMin: 30,
      crossesMidnight: false,
      note: 'Jornada',
    });
    const movements = await listMovementsByDate('2026-10-21');
    expect(movements).toHaveLength(1);
    expect(movement.note).toBe('Jornada');
    const day = await db.days.get('2026-10-21');
    expect(day?.kind).toBe('work');
  });

  it('impide registrar horas en una ausencia', async () => {
    await setDayKind('2026-10-21', 'vacation');
    await expect(
      addMovement({
        accountId: account.id,
        date: '2026-10-21',
        startMin: 540,
        endMin: 1020,
        breakMin: 0,
        crossesMidnight: false,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('borra el día vacío al quitar el último tramo', async () => {
    const movement = await addMovement({
      accountId: account.id,
      date: '2026-10-21',
      startMin: 540,
      endMin: 1020,
      breakMin: 0,
      crossesMidnight: false,
    });
    await deleteMovement(movement.id);
    expect(await db.days.get('2026-10-21')).toBeUndefined();
  });

  it('gestiona adjuntos y su contador', async () => {
    await setDayKind('2026-10-21', 'work', 'Con parte');
    const attachment = await addAttachment({
      date: '2026-10-21',
      name: 'parte.pdf',
      mime: 'application/pdf',
      size: 100,
      thumb: null,
      blob: new Blob([new Uint8Array(100)]),
    });
    let stats = await attachmentStats();
    expect(stats.count).toBe(1);
    expect(stats.totalSize).toBe(100);
    expect((await db.days.get('2026-10-21'))?.attachmentCount).toBe(1);

    await deleteAttachment(attachment.id);
    stats = await attachmentStats();
    expect(stats.count).toBe(0);
    expect((await db.days.get('2026-10-21'))?.attachmentCount).toBe(0);
    expect(await listAttachments('2026-10-21')).toHaveLength(0);
  });

  it('conserva el día al borrar datos si quedan adjuntos', async () => {
    await setDayKind('2026-10-21', 'vacation', 'Nota');
    await addAttachment({
      date: '2026-10-21',
      name: 'justificante.pdf',
      mime: 'application/pdf',
      size: 20,
      thumb: null,
      blob: new Blob([new Uint8Array(20)]),
    });

    await deleteDayData('2026-10-21', false);

    const day = await db.days.get('2026-10-21');
    expect(day?.kind).toBe('work');
    expect(day?.note).toBeUndefined();
    expect(day?.attachmentCount).toBe(1);
    expect(await listAttachments('2026-10-21')).toHaveLength(1);
  });

  it('elimina el día y sus adjuntos si se pide', async () => {
    await addAttachment({
      date: '2026-10-21',
      name: 'justificante.pdf',
      mime: 'application/pdf',
      size: 20,
      thumb: null,
      blob: new Blob([new Uint8Array(20)]),
    });

    await deleteDayData('2026-10-21', true);

    expect(await db.days.get('2026-10-21')).toBeUndefined();
    expect(await listAttachments('2026-10-21')).toHaveLength(0);
  });

  it('muestra y limpia huérfanos', async () => {
    const attachment = await addAttachment({
      date: '2026-10-21',
      name: 'captura.jpg',
      mime: 'image/jpeg',
      size: 10,
      thumb: null,
      blob: new Blob([new Uint8Array(10)]),
    });
    await db.days.delete('2026-10-21');
    const result = await cleanupAttachments();
    expect(result.removed).toBe(1);
    expect(await db.attachments.get(attachment.id)).toBeUndefined();
  });

  it('no permite borrar cuentas con movimientos', async () => {
    await addMovement({
      accountId: account.id,
      date: '2026-10-21',
      startMin: 540,
      endMin: 1020,
      breakMin: 0,
      crossesMidnight: false,
    });
    await expect(deleteAccount(account.id)).rejects.toThrow(/movimiento/);
  });

  it('guarda el borrador del día completa y atómicamente', async () => {
    const first = await addMovement({
      accountId: account.id,
      date: '2026-10-21',
      startMin: 540,
      endMin: 1020,
      breakMin: 30,
      crossesMidnight: false,
      note: 'Antiguo',
    });
    const second = await addMovement({
      accountId: account.id,
      date: '2026-10-21',
      startMin: 1080,
      endMin: 1140,
      breakMin: 0,
      crossesMidnight: false,
    });
    const oldAttachment = await addAttachment({
      date: '2026-10-21',
      name: 'viejo.pdf',
      mime: 'application/pdf',
      size: 20,
      thumb: null,
      blob: new Blob([new Uint8Array(20)]),
    });
    const keptAttachment = await addAttachment({
      date: '2026-10-21',
      name: 'parte.pdf',
      mime: 'application/pdf',
      size: 30,
      thumb: null,
      blob: new Blob([new Uint8Array(30)]),
    });

    await saveDayDraft({
      date: '2026-10-21',
      kind: 'work',
      note: 'Nota nueva',
      movements: [
        {
          id: first.id,
          accountId: account.id,
          startMin: 600,
          endMin: 1080,
          breakMin: 15,
          crossesMidnight: false,
          note: 'Actualizado',
        },
        {
          accountId: account.id,
          startMin: 1200,
          endMin: 1260,
          breakMin: 0,
          crossesMidnight: false,
        },
      ],
      removedMovementIds: [second.id],
      attachmentAdds: [
        {
          name: 'nuevo.jpg',
          mime: 'image/jpeg',
          size: 40,
          thumb: null,
          blob: new Blob([new Uint8Array(40)]),
        },
      ],
      attachmentDeletes: [oldAttachment.id],
    });

    const movements = await listMovementsByDate('2026-10-21');
    expect(movements).toHaveLength(2);
    expect(movements.find((movement) => movement.id === first.id)?.startMin).toBe(
      600,
    );
    expect(movements.find((movement) => movement.id === second.id)).toBeUndefined();
    expect(
      movements.find((movement) => movement.startMin === 1200)?.note,
    ).toBeUndefined();

    const attachments = await listAttachments('2026-10-21');
    expect(attachments).toHaveLength(2);
    expect(attachments.some((item) => item.id === oldAttachment.id)).toBe(false);
    expect(attachments.some((item) => item.id === keptAttachment.id)).toBe(true);
    expect(attachments.some((item) => item.name === 'nuevo.jpg')).toBe(true);

    const day = await db.days.get('2026-10-21');
    expect(day?.kind).toBe('work');
    expect(day?.note).toBe('Nota nueva');
    expect(day?.attachmentCount).toBe(2);
  });

  it('permite guardar el resto del día con tramos de una cuenta archivada', async () => {
    const movement = await addMovement({
      accountId: account.id,
      date: '2026-10-21',
      startMin: 540,
      endMin: 1020,
      breakMin: 0,
      crossesMidnight: false,
    });
    await updateAccount(account.id, { archived: 1 });

    await saveDayDraft({
      date: '2026-10-21',
      kind: 'work',
      note: 'Nota con cuenta archivada',
      movements: [
        {
          id: movement.id,
          accountId: account.id,
          startMin: 540,
          endMin: 1020,
          breakMin: 0,
          crossesMidnight: false,
        },
      ],
      removedMovementIds: [],
      attachmentAdds: [],
      attachmentDeletes: [],
    });

    expect((await db.days.get('2026-10-21'))?.note).toBe(
      'Nota con cuenta archivada',
    );
    expect(await listMovementsByDate('2026-10-21')).toHaveLength(1);
  });

  it('rechaza tramos nuevos en una cuenta archivada sin tocar el día', async () => {
    await updateAccount(account.id, { archived: 1 });

    await expect(
      saveDayDraft({
        date: '2026-10-21',
        kind: 'work',
        note: 'No debería guardarse',
        movements: [
          {
            accountId: account.id,
            startMin: 540,
            endMin: 1020,
            breakMin: 0,
            crossesMidnight: false,
          },
        ],
        removedMovementIds: [],
        attachmentAdds: [],
        attachmentDeletes: [],
      }),
    ).rejects.toThrow(/archivada/);

    expect(await db.days.get('2026-10-21')).toBeUndefined();
    expect(await listMovementsByDate('2026-10-21')).toHaveLength(0);
  });

  it('elimina los tramos que quedan al marcar una ausencia', async () => {
    await addMovement({
      accountId: account.id,
      date: '2026-10-21',
      startMin: 540,
      endMin: 1020,
      breakMin: 0,
      crossesMidnight: false,
    });

    await saveDayDraft({
      date: '2026-10-21',
      kind: 'vacation',
      note: 'Vacaciones',
      movements: [],
      removedMovementIds: [],
      attachmentAdds: [],
      attachmentDeletes: [],
    });

    expect(await listMovementsByDate('2026-10-21')).toHaveLength(0);
    const day = await db.days.get('2026-10-21');
    expect(day?.kind).toBe('vacation');
    expect(day?.note).toBe('Vacaciones');
  });

  it('elimina el día al guardar un borrador vacío', async () => {
    const movement = await addMovement({
      accountId: account.id,
      date: '2026-10-21',
      startMin: 540,
      endMin: 1020,
      breakMin: 0,
      crossesMidnight: false,
    });
    const attachment = await addAttachment({
      date: '2026-10-21',
      name: 'justificante.pdf',
      mime: 'application/pdf',
      size: 20,
      thumb: null,
      blob: new Blob([new Uint8Array(20)]),
    });

    await saveDayDraft({
      date: '2026-10-21',
      kind: 'work',
      note: '',
      movements: [],
      removedMovementIds: [movement.id],
      attachmentAdds: [],
      attachmentDeletes: [attachment.id],
    });

    expect(await db.days.get('2026-10-21')).toBeUndefined();
    expect(await listMovementsByDate('2026-10-21')).toHaveLength(0);
    expect(await listAttachments('2026-10-21')).toHaveLength(0);
  });

  it('rechaza una ausencia con tramos en el borrador', async () => {
    await expect(
      saveDayDraft({
        date: '2026-10-21',
        kind: 'vacation',
        note: 'Vacaciones',
        movements: [
          {
            accountId: account.id,
            startMin: 540,
            endMin: 1020,
            breakMin: 0,
            crossesMidnight: false,
          },
        ],
        removedMovementIds: [],
        attachmentAdds: [],
        attachmentDeletes: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await db.days.get('2026-10-21')).toBeUndefined();
    expect(await listMovementsByDate('2026-10-21')).toHaveLength(0);
  });
});
