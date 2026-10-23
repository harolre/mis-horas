const STORAGE_KEY = 'mis-horas-movement-templates';

export interface MovementTemplate {
  id: string;
  name: string;
  accountId: string;
  startMin: number;
  endMin: number;
  breakMin: number;
  crossesMidnight: boolean;
}

export type MovementTemplateValues = Pick<
  MovementTemplate,
  'accountId' | 'startMin' | 'endMin' | 'breakMin' | 'crossesMidnight'
>;

function isTemplate(value: unknown): value is MovementTemplate {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MovementTemplate>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.accountId === 'string' &&
    Number.isInteger(item.startMin) &&
    Number.isInteger(item.endMin) &&
    Number.isInteger(item.breakMin) &&
    typeof item.crossesMidnight === 'boolean'
  );
}

export function loadMovementTemplates(): MovementTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isTemplate).map((item) => ({
          id: item.id,
          name: item.name,
          accountId: item.accountId,
          startMin: item.startMin,
          endMin: item.endMin,
          breakMin: item.breakMin,
          crossesMidnight: item.crossesMidnight,
        }))
      : [];
  } catch {
    return [];
  }
}

export function saveMovementTemplate(
  name: string,
  values: MovementTemplateValues,
): MovementTemplate[] {
  const templates = loadMovementTemplates();
  const template: MovementTemplate = {
    id: `template-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: name.trim(),
    ...values,
  };
  const next = [...templates, template];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function updateMovementTemplate(
  id: string,
  name: string,
  values: MovementTemplateValues,
): MovementTemplate[] {
  const templates = loadMovementTemplates();
  if (!templates.some((template) => template.id === id)) {
    throw new Error('No se encontró la plantilla.');
  }
  const next = templates.map((template) =>
    template.id === id
      ? { id, name: name.trim(), ...values }
      : template,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteMovementTemplate(id: string): MovementTemplate[] {
  const next = loadMovementTemplates().filter((template) => template.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
