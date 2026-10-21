import Dexie, { type Table } from 'dexie';
import type {
  Account,
  Attachment,
  AttachmentFile,
  DayEntry,
  Movement,
  Settings,
} from '../types';
import { defaultAccount, defaultSettings } from './defaults';

export class MisHorasDB extends Dexie {
  accounts!: Table<Account, string>;
  movements!: Table<Movement, string>;
  days!: Table<DayEntry, string>;
  attachments!: Table<Attachment, string>;
  attachmentFiles!: Table<AttachmentFile, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'mis-horas-db') {
    super(name);
    this.version(1).stores({
      accounts: 'id, name, archived',
      movements: 'id, date, accountId, [accountId+date], [date+accountId]',
      days: 'date',
      attachments: 'id, date, [date+createdAt], createdAt',
      attachmentFiles: 'id',
      settings: 'id',
    });
    this.on('populate', (transaction) => {
      transaction.table('settings').add(defaultSettings());
      transaction.table('accounts').add(defaultAccount());
    });
  }
}

export const db = new MisHorasDB();
