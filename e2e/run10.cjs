// Several operations categorized at once (from To do and from similar operations), and what the
// money sent to a shared everyday account paid for, on the real build. Files generated here with
// invented names and amounts.
// Run: node e2e/run10.cjs http://localhost:4173/finanzas/
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const shots = path.join(__dirname, 'shots');
const PASS = 'violet river paper lamp';

function write(name, text) {
  const file = path.join(os.tmpdir(), name);
  fs.writeFileSync(file, Buffer.from(text, 'latin1'));
  return file;
}
const sgRows = [
  ['28/10/2026', 'CARTE X1234 27/10', 'CARTE X1234 27/10 CHEZ TEST LILI 900000000000001IOPD', '-12,50', 'EUR'],
  ['21/10/2026', 'CARTE X1234 20/10', 'CARTE X1234 20/10 CHEZ TEST LILI 900000000000002IOPD', '-9,80', 'EUR'],
  ['14/10/2026', 'CARTE X1234 13/10', 'CARTE X1234 13/10 FROMAGERIE TESTU 900000000000003IOPD', '-18,00', 'EUR'],
  ['07/10/2026', 'CARTE X1234 06/10', 'CARTE X1234 06/10 CHEZ TEST LILI 900000000000004IOPD', '-11,00', 'EUR'],
  ['02/10/2026', '000001 VIR PERM', '000001 VIR PERM POUR: COMPTE JOINT TEST REF: 900000000011 MOTIF: Courses', '-500,00', 'EUR'],
  ['01/10/2026', 'VIR RECU    500002', 'VIR RECU    5000022222S DE: ACME AGENCE MOTIF: ACME PAYE 202610', '2400,00', 'EUR'],
];
const SG = write('sg_bulk.csv', [
  `="0000123400009999";01/10/2026;31/10/2026;${sgRows.length};31/10/2026;1848,70 EUR`,
  '',
  "Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise;",
  ...sgRows.map((r) => r.join(';') + ';'),
  '',
].join('\r\n'));
const HB = write('hb_bulk.csv', [
  'Compte de chèques ****7777;Solde au 31/10/2026;150,00;EUR;;;',
  ';;;;;;',
  'Date operation;Categorie operation;Sous Categorie operation;Libelle operation;Montant operation;Pointage operation;Commentaire operation',
  '25-10-2026;Loisirs et Sorties;Restaurants, bars;PAIEMENT CB LE ZINC TEST DU 24/10/26 A TOULOUSE - CARTE*2222;-200;;',
  '12-10-2026;Vie Quotidienne;Alimentation, supermarché;PAIEMENT CB CARREFOUR DU 11/10/26 A TOULOUSE - CARTE*2222;-600;;',
  '05-10-2026;Revenus;Virement reçu;VIREMENT DE MME PARTNER TEST - MOTIF : COURSES;450;;',
  '03-10-2026;Revenus;Virement reçu;VIREMENT DE M. TEST PERSONNE - MOTIF : COURSES;500;;',
].join('\n'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const nav = (t) => page.locator('nav').getByText(t, { exact: true }).click();
  const shot = (n, full = false) => page.screenshot({ path: path.join(shots, n + '.png'), fullPage: full });
  const r = {};
  await page.goto(process.argv[2]);
  await page.getByText('Create my vault').click();
  await page.fill('#p1', PASS);
  await page.fill('#p2', PASS);
  await page.getByRole('button', { name: 'Create the vault' }).click();
  await page.getByTestId('recovery-key').waitFor({ timeout: 20000 });
  await page.getByLabel('I have written down my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.setInputFiles('input[type=file]', SG);
  await page.getByRole('button', { name: /^Import 6/ }).click();
  await page.getByText('Import done').waitFor();
  await nav('Overview');
  await page.getByRole('button', { name: 'Import' }).first().click();
  await page.setInputFiles('input[type=file]', HB);
  await page.fill('#acc', 'Joint account');
  await page.getByRole('button', { name: /^Import 4/ }).click();
  await page.getByText('Import done').waitFor();
  r.hbImport = await page.locator('.card').filter({ hasText: 'Import done' }).innerText();

  // 1. From To do: tick several, one category
  await nav('Overview');
  await page.getByRole('button', { name: /^Categorize \d+ operation/ }).click();
  await page.getByTestId('selbar').waitFor();
  r.todoList = await page.locator('.tx .name').allInnerTexts();
  await page.locator('.tx').nth(0).click();
  await page.locator('.tx').nth(1).click();
  await page.getByLabel('Category for the selected operations').selectOption('groceries');
  await shot('100_select_todo');
  r.selbar = await page.getByTestId('selbar').innerText();
  await page.getByTestId('selbar').getByRole('button', { name: 'Apply' }).click();
  r.toast = await page.locator('.toast').innerText();
  r.todoAfter = await page.locator('.tx .name').allInnerTexts();
  await page.getByRole('button', { name: 'Done' }).click();
  r.selbarGone = (await page.getByTestId('selbar').count()) === 0;

  // 2. From similar operations
  await page.getByLabel('Category').selectOption('');
  await page.locator('.tx').filter({ hasText: 'Joint Test' }).first().click().catch(() => {});
  await page.getByRole('button', { name: 'Close' }).last().click().catch(() => {});
  await page.locator('.tx').filter({ hasText: 'Acme' }).first().click();
  await page.getByRole('button', { name: 'Find similar operations' }).click();
  await page.getByLabel('Similar amount').check().catch(() => {});
  await page.getByLabel('Same or similar name').uncheck().catch(() => {});
  await page.getByLabel('Same or similar name').check();
  await page.getByLabel('Similar amount').uncheck();
  const simBtn = page.getByTestId('similar-select');
  r.similarButton = (await simBtn.count()) ? await simBtn.innerText() : null;
  await page.getByRole('button', { name: 'Close' }).last().click();
  // a merchant seen three times
  await page.locator('.tx').filter({ hasText: 'Chez Test Lili' }).first().click();
  await page.getByRole('button', { name: 'Find similar operations' }).click();
  await page.getByTestId('similar-select').click();
  r.idsChip = await page.locator('.chip.on').first().innerText();
  r.preselected = await page.getByTestId('selbar').locator('strong').innerText();
  r.rowsShown = await page.locator('.tx').count();
  await shot('101_select_similar');
  await page.getByLabel('Category for the selected operations').selectOption('eating_out');
  await page.getByTestId('selbar').getByRole('button', { name: 'Apply' }).click();
  r.toast2 = await page.locator('.toast').innerText();
  r.subs = await page.locator('.tx .sub').allInnerTexts();

  // 3. Spending of the current account, with what the money sent to the joint account paid for
  await nav('Spending');
  await page.getByRole('tab', { name: 'One month' }).click();
  await page.getByRole('button', { name: /^Oct 26/ }).click().catch(() => {});
  r.heroAll = await page.locator('.hero').innerText();
  const chips = page.getByRole('group', { name: 'Accounts in this view' });
  await chips.getByRole('button', { name: /Société Générale/ }).click();
  r.look = await page.getByTestId('look-through').innerText();
  r.heroSg = await page.locator('.hero').innerText();
  r.heroHint = await page.locator('.card').first().innerText();
  r.categories = await page.locator('.catrow .name').allInnerTexts();
  r.transfers = await page.getByTestId('transfers-card').innerText();
  await shot('102_spending_through', true);
  await page.getByTestId('look-through').locator('input').uncheck();
  r.heroSgDirect = await page.locator('.hero').innerText();

  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
