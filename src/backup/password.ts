export interface PasswordScore {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  percent: number;
  color: string;
}

export function scorePassword(password: string): PasswordScore {
  if (!password) {
    return { score: 0, label: 'Vacía', percent: 0, color: 'var(--border)' };
  }
  let points = 0;
  if (password.length >= 8) points += 1;
  if (password.length >= 12) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/\d/.test(password)) points += 1;
  if (/[^A-Za-z0-9]/.test(password)) points += 1;
  if (password.length < 8) points = Math.min(points, 1);

  const score = Math.min(4, points) as PasswordScore['score'];
  const labels = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte'];
  const colors = [
    'var(--danger)',
    'var(--danger)',
    'var(--warning)',
    'var(--success)',
    'var(--success)',
  ];
  return {
    score,
    label: labels[score],
    percent: (score / 4) * 100,
    color: colors[score],
  };
}
