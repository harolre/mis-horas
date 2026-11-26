import { test, expect, type Page } from '@playwright/test';

async function openDay(page: Page, index = 0) {
  const day = page.locator('.week-day-summary').nth(index);
  await expect(day).toBeEnabled();
  await day.click();
  await expect(page.locator('.modal')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Inicio' }),
  ).toBeVisible();
});

test('registra un tramo de médico como tiempo trabajado', async ({
  page,
}) => {
  await openDay(page);
  const modal = page.locator('.modal');

  await modal.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(modal.locator('.movement-focus')).toBeVisible();
  await modal.getByRole('tab', { name: 'Médico' }).click();

  await modal.locator('#draft-movement-start').fill('08:00');
  await modal.locator('#draft-movement-end').fill('10:00');
  await expect(modal.locator('.movement-duration-preview')).toHaveText(
    '2h',
  );

  await modal.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(
    modal.locator('.movement-row .badge.medical'),
  ).toHaveText('Médico');
  await expect(
    modal.locator('.sheet-summary-item').first().locator('strong'),
  ).toHaveText('2h');

  await modal.getByRole('button', { name: 'Guardar día' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(
    page
      .locator('.week-day-summary')
      .first()
      .locator('.week-day-hours strong'),
  ).toHaveText('2h');
});

test('marca vacaciones y reduce el objetivo semanal', async ({ page }) => {
  await openDay(page, 1);
  const modal = page.locator('.modal');

  await modal
    .getByRole('button', { name: 'Vacaciones', exact: true })
    .click();
  await expect(modal.locator('.day-status-row .badge')).toHaveText(
    'Vacaciones',
  );
  await modal.getByRole('button', { name: 'Guardar día' }).click();

  await expect(page.locator('.hero-meta')).toContainText('Objetivo 32h');
  await expect(
    page.locator('.week-day-summary').nth(1),
  ).toContainText('Vacaciones');
});

test('el calendario muestra el resumen del día y permite editarlo', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Calendario', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Calendario' }),
  ).toBeVisible();

  await page.locator('.calendar-cell:not(.outside)').nth(10).click();
  const card = page.locator('.calendar-day-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Editar día' })).toBeVisible();

  await card.getByRole('button', { name: 'Editar día' }).click();
  await expect(page.locator('.modal')).toBeVisible();
  await page
    .locator('.modal-head button[aria-label="Cerrar"]')
    .click();
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('prepara el PDF del periodo seleccionado', async ({ page }) => {
  await page.getByRole('button', { name: 'Resumen', exact: true }).click();
  await page.getByRole('button', { name: 'PDF', exact: true }).click();

  const modal = page.locator('.modal');
  await expect(
    modal.getByRole('heading', { name: 'Exportar PDF' }),
  ).toBeVisible();
  await expect(modal.locator('.export-preview')).toBeVisible();
  await modal.getByRole('button', { name: 'Preparar PDF' }).click();
  await expect(modal.locator('.banner.success')).toContainText(
    'PDF listo',
    { timeout: 20_000 },
  );
});

test('exporta la copia de datos desde Ajustes', async ({ page }) => {
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Exportar datos' }).click();

  const modal = page.locator('.modal');
  await modal.locator('#backup-password').fill('copia-segura-123');
  await modal.locator('#backup-password-confirm').fill('copia-segura-123');
  await modal.getByRole('button', { name: 'Exportar datos' }).click();
  await expect(modal.locator('.banner.success')).toContainText(
    'Copia lista',
    { timeout: 20_000 },
  );

  const downloadPromise = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Descargar archivo' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mhdata$/);
});
