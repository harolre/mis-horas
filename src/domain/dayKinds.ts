import type { DayKind } from '../types';

export interface DayKindInfo {
  value: DayKind;
  label: string;
  pluralLabel: string;
  shortLabel: string;
  chipClass: string;
  description: string;
  colorVar: string;
  softColorVar: string;
}

export const DAY_KINDS: readonly DayKindInfo[] = [
  {
    value: 'work',
    label: 'Trabajo',
    pluralLabel: 'Trabajo',
    shortLabel: 'Trabajo',
    chipClass: '',
    description: 'Día laborable',
    colorVar: '--primary',
    softColorVar: '--primary-soft',
  },
  {
    value: 'vacation',
    label: 'Vacaciones',
    pluralLabel: 'Vacaciones',
    shortLabel: 'Vac',
    chipClass: 'vacation',
    description: 'Vacaciones',
    colorVar: '--vacation',
    softColorVar: '--vacation-soft',
  },
  {
    value: 'personal',
    label: 'Asunto propio',
    pluralLabel: 'Asuntos propios',
    shortLabel: 'Propio',
    chipClass: 'personal',
    description: 'Asunto propio',
    colorVar: '--personal',
    softColorVar: '--personal-soft',
  },
  {
    value: 'holiday',
    label: 'Festivo',
    pluralLabel: 'Festivos',
    shortLabel: 'Fest',
    chipClass: 'holiday',
    description: 'Festivo',
    colorVar: '--holiday',
    softColorVar: '--holiday-soft',
  },
  {
    value: 'sick',
    label: 'Baja',
    pluralLabel: 'Bajas',
    shortLabel: 'Baja',
    chipClass: 'sick',
    description: 'Baja',
    colorVar: '--sick',
    softColorVar: '--sick-soft',
  },
];

export const ABSENCE_KINDS = (
  ['vacation', 'personal', 'sick', 'holiday'] as const
).map(
  (value) =>
    dayKindInfo(value) as DayKindInfo & { value: typeof value },
);

export function dayKindInfo(kind: DayKind): DayKindInfo {
  return DAY_KINDS.find((item) => item.value === kind) ?? DAY_KINDS[0];
}
