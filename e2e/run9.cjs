// Transfer names on a savings account reached only through the current account (real build).
// The bank files are generated here with invented names and amounts.
// Run: node e2e/run9.cjs http://localhost:4173/finanzas/
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const shots = path.join(__dirname, 'shots');
const PASS = 'violet river paper lamp';

function sgCsv(rows) {
  const text = [
    `="0000123400009999";01/09/2026;02/11/2026;${rows.length};02/11/2026;980,50 EUR`,
    '',
    "Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise;",
    ...rows.map((r) => r.join(';') + ';'),
    '',
  ].join('\r\n');
  const file = path.join(os.tmpdir(), `sg_names_${rows.length}.csv`);
  fs.writeFileSync(file, Buffer.from(text, 'latin1'));
  return file;
}
const BASE = [
  ['30/10/2026', 'CARTE X1234 29/10', 'CARTE X1234 29/10 BOULANGERIE EXEMPLE 900000000000001IOPD', '-4,80', 'EUR'],
  ['26/10/2026', 'VIR RECU    500002', 'VIR RECU    5000022222S DE: ACME - AGENCE COMPTABLE MOTIF: ACME PAYE 202610', '2400,00', 'EUR'],
  ['02/10/2026', '000001 VIR PERM', '000001 VIR PERM POUR: M. TEST PERSONNE REF: 900000000009 MOTIF: Epargne', '-300,00', 'EUR'],
  ['20/10/2026', 'VIR RECU 500004444', 'VIR RECU 5000044444444 DE: M TEST PERSONNE MOTIF: Retour', '120,00', 'EUR'],
];
const NEXT = [...BASE, ['02/11/2026', '000001 VIR PERM', '000001 VIR PERM POUR: M. TEST PERSONNE REF: 900000000010 MOTIF: Epargne', '-200,00', 'EUR']];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const nav = (t) => page.locator('nav').getByText(t, { exact: true }).click();
  const r = {};
  await page.goto(process.argv[2]);
  await page.getByText('Create my vault').click();
  await page.fill('#p1', PASS);
  await page.fill('#p2', PASS);
  await page.getByRole('button', { name: 'Create the vault' }).click();
  await page.getByTestId('recovery-key').waitFor({ timeout: 20000 });
  await page.getByLabel('I have written down my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.setInputFiles('input[type=file]', sgCsv(BASE));
  await page.getByRole('button', { name: /^Import 4/ }).click();
  await page.getByText('Import done').waitFor();

  // A savings account added by hand, with its balance at the end of September
  await nav('Overview');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Add an account' }).click();
  await page.fill('#na-name', 'Livret A');
  await page.fill('#na-bal', '1 000,00');
  await page.fill('#na-date', '2026-09-30');
  await page.getByRole('button', { name: 'Add the account' }).click();

  // Its transfer names, from Settings
  await page.getByRole('button', { name: /Transfer names and balance/ }).last().click();
  await page.getByTestId('transfer-names').waitFor();
  await page.fill('#tn', 'M. Test Personne');
  r.preview = await page.getByTestId('names-preview').innerText();
  await page.screenshot({ path: path.join(shots, '90_transfer_names_preview.png') });
  await page.getByTestId('names-preview').getByRole('button', { name: 'Save' }).click();
  r.afterSave = await page.getByTestId('transfer-names').innerText();
  r.balance = await page.getByTestId('balance-card').innerText();
  await page.getByRole('button', { name: 'Close' }).last().click();
  r.settingsButton = await page.getByRole('button', { name: /Transfer names and balance/ }).last().innerText();

  // Next month's file: the new transfer is recorded in the savings account by itself
  await nav('Overview');
  await page.getByRole('button', { name: 'Import' }).first().click();
  await page.setInputFiles('input[type=file]', sgCsv(NEXT));
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await page.getByText('Import done').waitFor();
  r.importDone = await page.locator('.card').filter({ hasText: 'Import done' }).innerText();
  await nav('Overview');
  r.overviewLivret = await page.getByRole('button', { name: /Livret A/ }).innerText();

  // The operation in the savings account says where it came from
  await nav('Operations');
  await page.getByRole('group', { name: 'Accounts' }).getByRole('button', { name: /Livret A/ }).click();
  r.savingsOps = await page.locator('.tx .sub').allInnerTexts();
  await page.locator('.tx').first().click();
  r.detail = await page.locator('dl.kv').innerText();
  await page.screenshot({ path: path.join(shots, '91_auto_recorded.png') });

  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
