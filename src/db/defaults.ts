import type { Account, Settings } from '../types';

export const ACCOUNT_COLORS = [
  '#2563eb',
  '#0d9488',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#ca8a04',
  '#0891b2',
  '#4b5563',
];

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

export function defaultSettings(): Settings {
  return {
    id: 'app',
    weekStart: 1,
    dailyTargets: [480, 480, 480, 480, 480, 0, 0],
    dateOverrides: {},
    updatedAt: Date.now(),
  };
}

export function defaultAccount(): Account {
  const now = Date.now();
  return {
    id: uuid(),
    name: 'Trabajo',
    color: ACCOUNT_COLORS[0],
    archived: 0,
    createdAt: now,
    updatedAt: now,
  };
}
