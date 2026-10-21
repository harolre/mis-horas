import type { DayKind } from '../../types';

export const DAY_KINDS: Array<{
  value: DayKind;
  label: string;
  chipClass: string;
  description: string;
}> = [
  { value: 'work', label: 'Trabajo', chipClass: '', description: 'Día laborable' },
  {
    value: 'vacation',
    label: 'Vacaciones',
    chipClass: 'vacation',
    description: 'Vacaciones',
  },
  {
    value: 'holiday',
    label: 'Festivo',
    chipClass: 'holiday',
    description: 'Festivo',
  },
  { value: 'sick', label: 'Baja', chipClass: 'sick', description: 'Baja' },
];

export function kindInfo(kind: DayKind) {
  return DAY_KINDS.find((item) => item.value === kind) ?? DAY_KINDS[0];
}
