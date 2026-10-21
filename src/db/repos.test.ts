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
  setDayKind,
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
});
