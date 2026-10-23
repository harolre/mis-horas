export type ISODate = string;
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type DayKind = 'work' | 'vacation' | 'holiday' | 'sick';

export interface Account {
  id: string;
  name: string;
  color: string;
  archived: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export interface Movement {
  id: string;
  accountId: string;
  date: ISODate;
  startMin: number;
  endMin: number;
  breakMin: number;
  crossesMidnight: 0 | 1;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DayEntry {
  date: ISODate;
  kind: DayKind;
  note?: string;
  attachmentCount?: number;
  updatedAt: number;
}

export interface Attachment {
  id: string;
  date: ISODate;
  name: string;
  mime: string;
  size: number;
  thumb: Blob | ArrayBuffer | null;
  createdAt: number;
}

export interface AttachmentFile {
  id: string;
  blob: Blob | ArrayBuffer;
}

export interface Settings {
  id: 'app';
  weekStart: Weekday;
  /** Siete valores en minutos, de lunes a domingo. */
  dailyTargets: number[];
  dateOverrides: Record<ISODate, number>;
  updatedAt: number;
}

export type ThemeMode = 'auto' | 'light' | 'dark';
