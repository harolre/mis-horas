import type {
  Account,
  DayEntry,
  Movement,
  Settings,
} from '../types';
import { isValidISODate } from '../domain/date';
import { defaultAccount } from '../db/defaults';
import { BackupError } from './format';

export function validateSettings(settings: Settings): Settings {
  if (
    !settings ||
    settings.weekStart < 1 ||
    settings.weekStart > 7 ||
    !Array.isArray(settings.dailyTargets) ||
    settings.dailyTargets.length !== 7 ||
    settings.dailyTargets.some(
      (minutes) => !Number.isFinite(minutes) || minutes < 0 || minutes > 1440,
    )
  ) {
    throw new BackupError('La configuración incluida en la copia no es válida.');
  }
  return { ...settings, id: 'app' };
}

export function validateMovements(
  movements: Movement[],
  accountIds: Set<string>,
): Movement[] {
  for (const movement of movements) {
    if (
      !movement ||
      typeof movement.id !== 'string' ||
      typeof movement.accountId !== 'string' ||
      !isValidISODate(movement.date) ||
      !Number.isInteger(movement.startMin) ||
      !Number.isInteger(movement.endMin) ||
      !Number.isInteger(movement.breakMin) ||
      movement.startMin < 0 ||
      movement.startMin > 1439 ||
      movement.endMin < 0 ||
      movement.endMin > 1439 ||
      movement.breakMin < 0 ||
      (movement.category !== undefined &&
        movement.category !== 'work' &&
        movement.category !== 'medical')
    ) {
      throw new BackupError('Hay un movimiento no válido en la copia.');
    }
    if (!accountIds.has(movement.accountId)) {
      throw new BackupError('Un movimiento apunta a una cuenta inexistente.');
    }
  }
  return movements;
}

export function validateAccounts(accounts: Account[]): Account[] {
  const result = accounts.map((account) => {
    if (
      !account ||
      typeof account.id !== 'string' ||
      typeof account.name !== 'string' ||
      !account.name.trim() ||
      typeof account.color !== 'string'
    ) {
      throw new BackupError('Hay una cuenta no válida en la copia.');
    }
    return { ...account, archived: (account.archived ? 1 : 0) as 0 | 1 };
  });
  if (result.length === 0) {
    result.push(defaultAccount());
  }
  if (!result.some((account) => !account.archived)) {
    result[0] = { ...result[0], archived: 0 };
  }
  return result;
}

export function validateDays(days: DayEntry[]): DayEntry[] {
  return days
    .filter(
      (day): day is DayEntry =>
        Boolean(day) &&
        typeof day.date === 'string' &&
        isValidISODate(day.date) &&
        (day.kind === 'work' ||
          day.kind === 'vacation' ||
          day.kind === 'personal' ||
          day.kind === 'holiday' ||
          day.kind === 'sick'),
    )
    .map((day) => ({ ...day }));
}
