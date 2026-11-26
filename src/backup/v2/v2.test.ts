import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { defaultAccount, defaultSettings } from '../../db/defaults';
import { addAttachment, addMovement } from '../../db/repos';
import {
  applyDataBackup,
  createDataBackup,
  readDataBackup,
} from './data';
import {
  createAttachmentsBackup,
  restoreAttachmentsBackup,
} from './attachments';
import { detectBackupKind } from './detect';
import type { Account } from '../../types';

let account: Account;
const password = 'copia-segura-123';
const options = { iterations: 1000, chunkSize: 16 * 1024 };

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  account = defaultAccount();
  await db.accounts.put(account);
  await db.settings.put(defaultSettings());
  await addMovement({
    accountId: account.id,
    date: '2026-10-21',
    startMin: 540,
    endMin: 1020,
    breakMin: 0,
    crossesMidnight: false,
  });
  await addAttachment({
    date: '2026-10-21',
    name: 'fichaje-2026.jpg',
    mime: 'image/jpeg',
    size: 7000,
    thumb: new Blob([new Uint8Array(300)], { type: 'image/jpeg' }),
    blob: new Blob([new Uint8Array(7000)], { type: 'image/jpeg' }),
  });
  await addAttachment({
    date: '2026-10-22',
    name: 'fichaje-2026-b.jpg',
    mime: 'image/jpeg',
    size: 5000,
    thumb: new Blob([new Uint8Array(200)], { type: 'image/jpeg' }),
    blob: new Blob([new Uint8Array(5000)], { type: 'image/jpeg' }),
  });
  await addAttachment({
    date: '2024-10-21',
    name: 'fichaje-2024.jpg',
    mime: 'image/jpeg',
    size: 4000,
    thumb: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
    blob: new Blob([new Uint8Array(4000)], { type: 'image/jpeg' }),
  });
});

afterAll(async () => {
  await db.close();
  await db.delete();
});

describe('copias separadas', () => {
  it('exporta y lee una copia de datos sin incluir los archivos', async () => {
    const backup = await createDataBackup(password, options);
    expect(await detectBackupKind(backup)).toBe('data');

    const payload = await readDataBackup(backup, password);
    expect(payload.movements).toHaveLength(1);
    expect(payload.accounts).toHaveLength(1);
    expect(payload.attachments).toHaveLength(3);
    expect(payload.attachments[0]).not.toHaveProperty('blob');
    expect(backup.size).toBeLessThan(20_000);
  });

  it('restaura los datos y deja archivadas las fotos que no están', async () => {
    const backup = await createDataBackup(password, options);
    const payload = await readDataBackup(backup, password);

    await Promise.all(db.tables.map((table) => table.clear()));
    const result = await applyDataBackup(payload);

    expect(result.movements).toBe(1);
    expect(result.archived).toBe(3);
    expect(await db.attachmentFiles.count()).toBe(0);
    const attachments = await db.attachments.toArray();
    expect(attachments).toHaveLength(3);
    expect(attachments.every((item) => item.archived === 1)).toBe(true);
    expect((await db.days.get('2026-10-21'))?.attachmentCount).toBe(1);
  });

  it('conserva los archivos que ya existen al restaurar solo los datos', async () => {
    const backup = await createDataBackup(password, options);
    const payload = await readDataBackup(backup, password);
    await Promise.all([
      db.accounts.clear(),
      db.movements.clear(),
      db.days.clear(),
      db.attachments.clear(),
      db.settings.clear(),
    ]);
    await applyDataBackup(payload);

    const restored = await db.attachments.toArray();
    expect(await db.attachmentFiles.count()).toBe(3);
    expect(restored.every((item) => item.archived === 0)).toBe(true);
  });

  it('restaura las fotos de un año por lotes y conserva las demás', async () => {
    const dataBackup = await createDataBackup(password, options);
    const dataPayload = await readDataBackup(dataBackup, password);
    const attachmentBackup = await createAttachmentsBackup(
      '2026',
      password,
      options,
    );
    expect(await detectBackupKind(attachmentBackup)).toBe('attachments');

    await Promise.all(db.tables.map((table) => table.clear()));
    await applyDataBackup(dataPayload);

    const result = await restoreAttachmentsBackup(
      attachmentBackup,
      password,
    );
    expect(result.restored).toBe(2);
    expect(await db.attachmentFiles.count()).toBe(2);
    const restored = await db.attachments.toArray();
    expect(restored.filter((item) => item.date.startsWith('2026'))).toHaveLength(
      2,
    );
    expect(
      restored
        .filter((item) => item.date.startsWith('2026'))
        .every((item) => item.archived === 0),
    ).toBe(true);
    expect(
      restored.find((item) => item.date === '2024-10-21')?.archived,
    ).toBe(1);
  });

  it('restaura una foto que ocupa varios bloques sin cargar el año entero', async () => {
    await addAttachment({
      date: '2025-03-10',
      name: 'fichaje-grande.jpg',
      mime: 'image/jpeg',
      size: 50_000,
      thumb: new Blob([new Uint8Array(400)], { type: 'image/jpeg' }),
      blob: new Blob([new Uint8Array(50_000)], { type: 'image/jpeg' }),
    });
    const backup = await createAttachmentsBackup('2025', password, options);
    await Promise.all(db.tables.map((table) => table.clear()));
    const result = await restoreAttachmentsBackup(backup, password);
    expect(result.restored).toBe(1);
    const file = await db.attachmentFiles.get(
      (await db.attachments.toArray())[0].id,
    );
    expect(file?.blob).toBeInstanceOf(ArrayBuffer);
    expect((file?.blob as ArrayBuffer).byteLength).toBe(50_000);
  });

  it('rechaza una contraseña incorrecta en el nuevo formato', async () => {
    const backup = await createDataBackup(password, options);
    await expect(readDataBackup(backup, 'otra-contraseña')).rejects.toThrow(
      /Contraseña incorrecta/,
    );
  });

  it('detecta una copia de adjuntos dañada', async () => {
    const backup = await createAttachmentsBackup('2026', password, options);
    const bytes = new Uint8Array(await backup.arrayBuffer());
    bytes[bytes.length - 1] ^= 0xff;
    await expect(
      restoreAttachmentsBackup(new Blob([bytes]), password),
    ).rejects.toThrow(/dañad|inválid|bloque|Contraseña/);
  });

  it('no permite exportar un año sin fotos', async () => {
    await expect(
      createAttachmentsBackup('2020', password, options),
    ).rejects.toThrow(/No hay adjuntos/);
  });
});
