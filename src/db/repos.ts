import type {
  Account,
  Attachment,
  DayEntry,
  DayKind,
  ISODate,
  Movement,
  Settings,
  Weekday,
} from '../types';
import { isValidISODate } from '../domain/date';
import { durationMinutes, movementsOverlap } from '../domain/time';
import { db } from './db';
import {
  ACCOUNT_COLORS,
  defaultAccount,
  defaultSettings,
  uuid,
} from './defaults';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

async function ensureUniqueAccountName(name: string, exceptId?: string) {
  const normalized = name.toLowerCase();
  const duplicate = await db.accounts
    .filter(
      (account) =>
        account.id !== exceptId && account.name.toLowerCase() === normalized,
    )
    .first();
  if (duplicate) {
    throw new ValidationError('Ya existe una cuenta con ese nombre.');
  }
}

export async function getSettings(): Promise<Settings> {
  const settings = await db.settings.get('app');
  if (settings) return settings;
  const fresh = defaultSettings();
  await db.settings.put(fresh);
  return fresh;
}

export async function saveSettings(
  patch: Partial<Omit<Settings, 'id'>>,
): Promise<void> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch, id: 'app', updatedAt: Date.now() };

  if (next.weekStart < 1 || next.weekStart > 7) {
    throw new ValidationError('Día de inicio de semana no válido.');
  }
  if (
    !Array.isArray(next.dailyTargets) ||
    next.dailyTargets.length !== 7 ||
    next.dailyTargets.some(
      (minutes) => !Number.isFinite(minutes) || minutes < 0 || minutes > 1440,
    )
  ) {
    throw new ValidationError('Los objetivos diarios deben estar entre 0 y 24 h.');
  }
  for (const [date, minutes] of Object.entries(next.dateOverrides)) {
    if (!isValidISODate(date)) {
      throw new ValidationError(`Fecha no válida: ${date}`);
    }
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
      throw new ValidationError('La excepción debe estar entre 0 y 24 h.');
    }
  }

  await db.settings.put(next);
}

export async function listAccounts(includeArchived = false): Promise<Account[]> {
  const accounts = await db.accounts.orderBy('name').toArray();
  return includeArchived ? accounts : accounts.filter((account) => !account.archived);
}

export async function getAccount(id: string): Promise<Account | undefined> {
  return db.accounts.get(id);
}

export async function createAccount(
  name: string,
  color = ACCOUNT_COLORS[0],
): Promise<Account> {
  const cleanName = normalizeName(name);
  if (!cleanName) throw new ValidationError('El nombre no puede estar vacío.');
  if (cleanName.length > 40) {
    throw new ValidationError('El nombre no puede superar los 40 caracteres.');
  }
  await ensureUniqueAccountName(cleanName);
  const now = Date.now();
  const account: Account = {
    id: uuid(),
    name: cleanName,
    color,
    archived: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.accounts.add(account);
  return account;
}

export async function updateAccount(
  id: string,
  patch: Partial<Pick<Account, 'name' | 'color' | 'archived'>>,
): Promise<void> {
  const current = await db.accounts.get(id);
  if (!current) throw new ValidationError('La cuenta no existe.');
  const name = patch.name === undefined ? current.name : normalizeName(patch.name);
  if (!name) throw new ValidationError('El nombre no puede estar vacío.');
  if (name.length > 40) {
    throw new ValidationError('El nombre no puede superar los 40 caracteres.');
  }
  if (patch.name !== undefined) {
    await ensureUniqueAccountName(name, id);
  }
  await db.accounts.update(id, {
    ...patch,
    name,
    updatedAt: Date.now(),
  });
}

export async function deleteAccount(id: string): Promise<void> {
  const account = await db.accounts.get(id);
  if (!account) return;
  const count = await db.movements.where('accountId').equals(id).count();
  if (count > 0) {
    throw new ValidationError(
      `La cuenta tiene ${count} movimiento${count === 1 ? '' : 's'}. Archívala o muévelos antes de borrarla.`,
    );
  }
  const activeAccounts = await db.accounts.filter((item) => !item.archived).count();
  if (!account.archived && activeAccounts <= 1) {
    throw new ValidationError('Debe quedar al menos una cuenta activa.');
  }
  await db.accounts.delete(id);
}

export interface MovementInput {
  accountId: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  breakMin: number;
  crossesMidnight: boolean;
  note?: string;
}

function validateMovementInput(input: MovementInput): void {
  if (!isValidISODate(input.date)) {
    throw new ValidationError('La fecha no es válida.');
  }
  if (
    !Number.isInteger(input.startMin) ||
    !Number.isInteger(input.endMin) ||
    input.startMin < 0 ||
    input.startMin > 1439 ||
    input.endMin < 0 ||
    input.endMin > 1439
  ) {
    throw new ValidationError('Las horas deben estar entre 00:00 y 23:59.');
  }
  if (!Number.isInteger(input.breakMin) || input.breakMin < 0) {
    throw new ValidationError('La pausa no puede ser negativa.');
  }
  const gross =
    input.endMin - input.startMin + (input.crossesMidnight ? 1440 : 0);
  if (gross <= 0) {
    throw new ValidationError('La hora de fin debe ser posterior a la de inicio.');
  }
  if (input.breakMin >= gross) {
    throw new ValidationError('La pausa no puede ser igual o mayor que el tramo.');
  }
  if ((input.note ?? '').length > 500) {
    throw new ValidationError('La nota no puede superar los 500 caracteres.');
  }
}

async function assertAccountUsable(accountId: string): Promise<void> {
  const account = await db.accounts.get(accountId);
  if (!account) throw new ValidationError('La cuenta seleccionada no existe.');
  if (account.archived) {
    throw new ValidationError('La cuenta está archivada.');
  }
}

export function findOverlaps(
  input: MovementInput,
  movements: Movement[],
  excludeId?: string,
): Movement[] {
  return movements.filter(
    (movement) =>
      movement.id !== excludeId &&
      movement.date === input.date &&
      movementsOverlap(movement, {
        startMin: input.startMin,
        endMin: input.endMin,
        breakMin: input.breakMin,
        crossesMidnight: input.crossesMidnight ? 1 : 0,
      }),
  );
}

async function ensureWorkDay(date: ISODate): Promise<void> {
  const day = await db.days.get(date);
  if (day && day.kind !== 'work') {
    throw new ValidationError(
      'El día está marcado como ausencia. Cámbialo a "Trabajo" para registrar horas.',
    );
  }
  if (!day) {
    const created: DayEntry = {
      date,
      kind: 'work',
      attachmentCount: 0,
      updatedAt: Date.now(),
    };
    await db.days.put(created);
  }
}

export async function addMovement(input: MovementInput): Promise<Movement> {
  validateMovementInput(input);
  await assertAccountUsable(input.accountId);
  return db.transaction('rw', db.movements, db.days, async () => {
    await ensureWorkDay(input.date);
    const now = Date.now();
    const movement: Movement = {
      id: uuid(),
      accountId: input.accountId,
      date: input.date,
      startMin: input.startMin,
      endMin: input.endMin,
      breakMin: input.breakMin,
      crossesMidnight: input.crossesMidnight ? 1 : 0,
      note: input.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    await db.movements.add(movement);
    return movement;
  });
}

export async function updateMovement(
  id: string,
  input: MovementInput,
): Promise<void> {
  validateMovementInput(input);
  await assertAccountUsable(input.accountId);
  const current = await db.movements.get(id);
  if (!current) throw new ValidationError('El movimiento no existe.');
  await db.transaction('rw', db.movements, db.days, async () => {
    await ensureWorkDay(input.date);
    await db.movements.update(id, {
      accountId: input.accountId,
      date: input.date,
      startMin: input.startMin,
      endMin: input.endMin,
      breakMin: input.breakMin,
      crossesMidnight: input.crossesMidnight ? 1 : 0,
      note: input.note?.trim() || undefined,
      updatedAt: Date.now(),
    });
    if (input.date !== current.date) {
      const remaining = await db.movements
        .where('date')
        .equals(current.date)
        .count();
      const oldDay = await db.days.get(current.date);
      if (
        remaining === 0 &&
        oldDay &&
        oldDay.kind === 'work' &&
        !oldDay.note &&
        !oldDay.attachmentCount
      ) {
        await db.days.delete(current.date);
      }
    }
  });
}

export async function deleteMovement(id: string): Promise<void> {
  await db.transaction('rw', db.movements, db.days, async () => {
    const movement = await db.movements.get(id);
    if (!movement) return;
    await db.movements.delete(id);
    const remaining = await db.movements.where('date').equals(movement.date).count();
    const day = await db.days.get(movement.date);
    if (
      remaining === 0 &&
      day &&
      day.kind === 'work' &&
      !day.note &&
      !day.attachmentCount
    ) {
      await db.days.delete(movement.date);
    }
  });
}

export async function listMovementsByDate(date: ISODate): Promise<Movement[]> {
  const movements = await db.movements.where('date').equals(date).toArray();
  return movements.sort((a, b) => a.startMin - b.startMin);
}

export async function listMovementsRange(
  from: ISODate,
  to: ISODate,
): Promise<Movement[]> {
  return db.movements.where('date').between(from, to, true, true).toArray();
}

export async function getMovement(id: string): Promise<Movement | undefined> {
  return db.movements.get(id);
}

export async function getDay(date: ISODate): Promise<DayEntry | undefined> {
  return db.days.get(date);
}

export async function listDaysRange(
  from: ISODate,
  to: ISODate,
): Promise<DayEntry[]> {
  return db.days.where('date').between(from, to, true, true).toArray();
}

export async function setDayKind(
  date: ISODate,
  kind: DayKind,
  note?: string,
): Promise<void> {
  const current = await db.days.get(date);
  const next: DayEntry = {
    date,
    kind,
    note: note === undefined ? current?.note : note.trim() || undefined,
    attachmentCount: current?.attachmentCount ?? 0,
    updatedAt: Date.now(),
  };
  await db.days.put(next);
}

export async function setDayNote(date: ISODate, note: string): Promise<void> {
  const current = await db.days.get(date);
  const next: DayEntry = {
    date,
    kind: current?.kind ?? 'work',
    note: note.trim() || undefined,
    attachmentCount: current?.attachmentCount ?? 0,
    updatedAt: Date.now(),
  };
  await db.days.put(next);
}

export async function deleteDayData(
  date: ISODate,
  includeAttachments: boolean,
): Promise<void> {
  await db.transaction(
    'rw',
    db.movements,
    db.days,
    db.attachments,
    db.attachmentFiles,
    async () => {
      await db.movements.where('date').equals(date).delete();
      if (includeAttachments) {
        const attachments = await db.attachments.where('date').equals(date).toArray();
        for (const attachment of attachments) {
          await db.attachmentFiles.delete(attachment.id);
          await db.attachments.delete(attachment.id);
        }
      }
      await db.days.delete(date);
    },
  );
}

export interface AttachmentInput {
  date: ISODate;
  name: string;
  mime: string;
  size: number;
  thumb: Blob | null;
  blob: Blob;
}

export async function addAttachment(input: AttachmentInput): Promise<Attachment> {
  if (!isValidISODate(input.date)) {
    throw new ValidationError('La fecha del adjunto no es válida.');
  }
  if (input.size <= 0 || !input.blob.size) {
    throw new ValidationError('El archivo está vacío.');
  }
  return db.transaction(
    'rw',
    db.attachments,
    db.attachmentFiles,
    db.days,
    async () => {
      const now = Date.now();
      const attachment: Attachment = {
        id: uuid(),
        date: input.date,
        name: input.name,
        mime: input.mime,
        size: input.size,
        thumb: input.thumb,
        createdAt: now,
      };
      await db.attachments.add(attachment);
      await db.attachmentFiles.add({ id: attachment.id, blob: input.blob });
      const day = await db.days.get(input.date);
      await db.days.put({
        date: input.date,
        kind: day?.kind ?? 'work',
        note: day?.note,
        attachmentCount: (day?.attachmentCount ?? 0) + 1,
        updatedAt: now,
      });
      return attachment;
    },
  );
}

export async function listAttachments(date: ISODate): Promise<Attachment[]> {
  const attachments = await db.attachments.where('date').equals(date).toArray();
  return attachments.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getAttachmentFile(id: string): Promise<Blob | null> {
  const file = await db.attachmentFiles.get(id);
  return file?.blob ?? null;
}

export async function deleteAttachment(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.attachments,
    db.attachmentFiles,
    db.days,
    async () => {
      const attachment = await db.attachments.get(id);
      if (!attachment) return;
      await db.attachments.delete(id);
      await db.attachmentFiles.delete(id);
      const day = await db.days.get(attachment.date);
      if (day) {
        await db.days.put({
          ...day,
          attachmentCount: Math.max(0, (day.attachmentCount ?? 1) - 1),
          updatedAt: Date.now(),
        });
      }
    },
  );
}

export interface AttachmentStats {
  count: number;
  totalSize: number;
}

export async function attachmentStats(): Promise<AttachmentStats> {
  const attachments = await db.attachments.toArray();
  return {
    count: attachments.length,
    totalSize: attachments.reduce((total, attachment) => total + attachment.size, 0),
  };
}

export interface CleanupResult {
  removed: number;
}

/**
 * Elimina adjuntos sin día asociado y archivos sin metadatos,
 * y recalcula los contadores de adjuntos por día.
 */
export async function cleanupAttachments(): Promise<CleanupResult> {
  return db.transaction(
    'rw',
    db.attachments,
    db.attachmentFiles,
    db.days,
    async () => {
      const attachments = await db.attachments.toArray();
      const days = await db.days.toArray();
      const dayDates = new Set(days.map((day) => day.date));
      let removed = 0;

      for (const attachment of attachments) {
        if (!dayDates.has(attachment.date)) {
          await db.attachments.delete(attachment.id);
          await db.attachmentFiles.delete(attachment.id);
          removed += 1;
        }
      }

      const remaining = await db.attachments.toArray();
      const metaIds = new Set(remaining.map((attachment) => attachment.id));
      const fileIds = await db.attachmentFiles.toCollection().primaryKeys();
      for (const id of fileIds) {
        if (!metaIds.has(id)) {
          await db.attachmentFiles.delete(id);
          removed += 1;
        }
      }

      const counts = new Map<string, number>();
      for (const attachment of remaining) {
        counts.set(attachment.date, (counts.get(attachment.date) ?? 0) + 1);
      }
      for (const day of days) {
        const count = counts.get(day.date) ?? 0;
        if ((day.attachmentCount ?? 0) !== count) {
          await db.days.put({ ...day, attachmentCount: count, updatedAt: Date.now() });
        }
      }

      return { removed };
    },
  );
}

export async function movementsCountForAccount(accountId: string): Promise<number> {
  return db.movements.where('accountId').equals(accountId).count();
}

export async function allMovements(): Promise<Movement[]> {
  return db.movements.toArray();
}

export async function eraseAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.movements,
      db.days,
      db.attachments,
      db.attachmentFiles,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.movements.clear(),
        db.days.clear(),
        db.attachments.clear(),
        db.attachmentFiles.clear(),
        db.settings.clear(),
      ]);
      await db.settings.put(defaultSettings());
      await db.accounts.put(defaultAccount());
    },
  );
}

export function weekdayLabel(weekdayValue: Weekday): string {
  return ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][
    weekdayValue - 1
  ];
}

export function totalForMovements(movements: Movement[]): number {
  return movements.reduce((total, movement) => total + durationMinutes(movement), 0);
}
