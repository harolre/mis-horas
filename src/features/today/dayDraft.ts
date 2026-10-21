import type { Attachment, ISODate, Movement } from '../../types';
import type { PreparedAttachment } from '../../attachments/process';
import type { DayMovementDraft } from '../../db/repos';
import { durationMinutes } from '../../domain/time';
import { uuid } from '../../db/defaults';

export interface DraftMovement {
  key: string;
  id?: string;
  accountId: string;
  startMin: number;
  endMin: number;
  breakMin: number;
  crossesMidnight: boolean;
  note?: string;
}

export interface PendingAttachment {
  key: string;
  attachment: Attachment;
  blob: Blob;
}

export function movementToDraft(movement: Movement): DraftMovement {
  return {
    key: movement.id,
    id: movement.id,
    accountId: movement.accountId,
    startMin: movement.startMin,
    endMin: movement.endMin,
    breakMin: movement.breakMin,
    crossesMidnight: movement.crossesMidnight === 1,
    note: movement.note,
  };
}

export function draftToInput(movement: DraftMovement): DayMovementDraft {
  return {
    id: movement.id,
    accountId: movement.accountId,
    startMin: movement.startMin,
    endMin: movement.endMin,
    breakMin: movement.breakMin,
    crossesMidnight: movement.crossesMidnight,
    note: movement.note,
  };
}

export function draftDuration(movement: DraftMovement): number {
  return durationMinutes({
    startMin: movement.startMin,
    endMin: movement.endMin,
    breakMin: movement.breakMin,
    crossesMidnight: movement.crossesMidnight ? 1 : 0,
  });
}

export function pendingFromPrepared(
  date: ISODate,
  prepared: PreparedAttachment,
): PendingAttachment {
  const key = `pending-${uuid()}`;
  return {
    key,
    attachment: {
      id: key,
      date,
      name: prepared.name,
      mime: prepared.mime,
      size: prepared.finalSize,
      thumb: prepared.thumb,
      createdAt: Date.now(),
    },
    blob: prepared.blob,
  };
}
