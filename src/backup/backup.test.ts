import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { defaultAccount, defaultSettings } from '../db/defaults';
import { addAttachment, addMovement } from '../db/repos';
import { createBackup } from './export';
import { applyBackup, readBackup } from './import';
import type { Account } from '../types';

let account: Account;
const password = 'copia-segura-123';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  account = defaultAccount();
  await db.accounts.put(account);
  await db.settings.put({
    ...defaultSettings(),
    dateOverrides: { '2026-12-24': 240 },
  });
  await addMovement({
    accountId: account.id,
    date: '2026-10-21',
    startMin: 540,
    endMin: 1020,
    breakMin: 30,
    crossesMidnight: false,
    note: 'Jornada completa',
  });
  await addAttachment({
    date: '2026-10-21',
    name: 'parte.pdf',
    mime: 'application/pdf',
    size: 5000,
    thumb: new Blob([new Uint8Array(200)], { type: 'image/jpeg' }),
    blob: new Blob([new Uint8Array(5000)], { type: 'application/pdf' }),
  });
});

afterAll(async () => {
  await db.close();
  await db.delete();
});

describe('copias cifradas', () => {
  it('exporta e importa datos y adjuntos', async () => {
    const backup = await createBackup(password, {
      iterations: 1000,
      chunkSize: 1024,
    });
    expect(backup.size).toBeGreaterThan(5000);

    const parsed = await readBackup(backup, password);
    expect(parsed.meta.movements).toHaveLength(1);
    expect(parsed.meta.accounts).toHaveLength(1);
    expect(parsed.meta.settings.dateOverrides['2026-12-24']).toBe(240);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].size).toBe(5000);
    expect(parsed.attachments[0].thumb).toBeInstanceOf(Blob);
    expect(parsed.files[0].blob).toBeInstanceOf(Blob);
    expect((parsed.files[0].blob as Blob).size).toBe(5000);

    await applyBackup(parsed);
    expect(await db.movements.count()).toBe(1);
    expect(await db.attachments.count()).toBe(1);
    expect(await db.attachmentFiles.count()).toBe(1);
    expect((await db.days.get('2026-10-21'))?.attachmentCount).toBe(1);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const backup = await createBackup(password, {
      iterations: 1000,
      chunkSize: 1024,
    });
    await expect(readBackup(backup, 'otra-contraseña')).rejects.toThrow(
      /Contraseña incorrecta/,
    );
  });

  it('detecta un archivo manipulado', async () => {
    const backup = await createBackup(password, {
      iterations: 1000,
      chunkSize: 1024,
    });
    const bytes = new Uint8Array(await backup.arrayBuffer());
    bytes[bytes.length - 1] ^= 0xff;
    await expect(readBackup(new Blob([bytes]), password)).rejects.toThrow(
      /dañado|Contraseña/,
    );
  });

  it('detecta una copia truncada', async () => {
    const backup = await createBackup(password, {
      iterations: 1000,
      chunkSize: 1024,
    });
    const truncated = backup.slice(0, backup.size - 20);
    await expect(readBackup(truncated, password)).rejects.toThrow(
      /incompleta|dañado/,
    );
  });
});
