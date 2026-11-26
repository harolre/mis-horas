import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { defaultAccount, defaultSettings } from '../db/defaults';
import { addAttachment, addMovement, setDayKind } from '../db/repos';
import type { Account } from '../types';
import { buildPeriodReport } from './periodReport';
import { createPeriodPdf, periodPdfFileName } from './pdf';

let account: Account;

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  account = defaultAccount();
  await db.accounts.put(account);
  await db.settings.put(defaultSettings());

  await setDayKind('2026-11-24', 'vacation');
  await addMovement({
    accountId: account.id,
    date: '2026-11-23',
    startMin: 480,
    endMin: 840,
    breakMin: 0,
    crossesMidnight: false,
  });
  await addMovement({
    accountId: account.id,
    date: '2026-11-26',
    startMin: 480,
    endMin: 600,
    breakMin: 0,
    crossesMidnight: false,
    category: 'medical',
  });
  await addAttachment({
    date: '2026-11-23',
    name: 'fichaje.jpg',
    mime: 'image/jpeg',
    size: 1000,
    thumb: null,
    blob: new Blob([new Uint8Array(1000)], { type: 'image/jpeg' }),
  });
});

afterAll(async () => {
  await db.close();
  await db.delete();
});

describe('informe de periodo', () => {
  it('prepara el detalle semanal con ausencias, médico y adjuntos', async () => {
    const report = await buildPeriodReport('week', '2026-11-26');
    expect(report.period).toBe('week');
    expect(report.days).toHaveLength(7);
    expect(report.worked).toBe(480);
    expect(report.medicalMinutes).toBe(120);
    expect(report.absences.vacation).toBe(1);
    expect(report.attachmentCount).toBe(1);
    expect(report.attachmentDays).toBe(1);
    expect(report.days.find((day) => day.date === '2026-11-26')?.movements[0].category).toBe(
      'medical',
    );
  });

  it('prepara el resumen anual por meses', async () => {
    const report = await buildPeriodReport('year', '2026-11-26');
    expect(report.period).toBe('year');
    expect(report.months).toHaveLength(12);
    expect(report.months[10].worked).toBe(480);
    expect(report.months[10].medicalMinutes).toBe(120);
    expect(report.days).toHaveLength(0);
  });

  it('genera un PDF válido y con nombre de archivo correcto', async () => {
    const report = await buildPeriodReport('month', '2026-11-26');
    const pdf = await createPeriodPdf(report);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.size).toBeGreaterThan(1000);
    expect(periodPdfFileName(report)).toBe('mis-horas-mes-2026-11.pdf');
  });

  it('genera el resumen anual con sus meses', async () => {
    const report = await buildPeriodReport('year', '2026-11-26');
    const pdf = await createPeriodPdf(report);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(pdf.size).toBeGreaterThan(1000);
    expect(periodPdfFileName(report)).toBe('mis-horas-ano-2026.pdf');
  });
});

