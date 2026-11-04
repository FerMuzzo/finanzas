// Similar operations offered while selecting, and categories you add, rename and delete
// (real build). Files generated here with invented names and amounts.
// Run: node e2e/run11.cjs http://localhost:4173/finanzas/
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const shots = path.join(__dirname, 'shots');
const PASS = 'violet river paper lamp';

const rows = [
  ['28/10/2026', 'CARTE X1234 27/10', 'CARTE X1234 27/10 CHEZ TEST LILI 900000000000001IOPD', '-12,50', 'EUR'],
  ['21/10/2026', 'CARTE X1234 20/10', 'CARTE X1234 20/10 CHEZ TEST LILI 900000000000002IOPD', '-9,80', 'EUR'],
  ['14/10/2026', 'CARTE X1234 13/10', 'CARTE X1234 13/10 KIOSQUE TESTA 900000000000003IOPD', '-4,00', 'EUR'],
  ['07/10/2026', 'CARTE X1234 06/10', 'CARTE X1234 06/10 CHEZ TEST LILI 900000000000004IOPD', '-11,00', 'EUR'],
  ['01/10/2026', 'VIR RECU    500002', 'VIR RECU    5000022222S DE: ACME AGENCE MOTIF: ACME PAYE 202610', '2400,00', 'EUR'],
];
const SG = path.join(os.tmpdir(), 'sg_cats.csv');
fs.writeFileSync(SG, Buffer.from([
  `="0000123400009999";01/10/2026;31/10/2026;${rows.length};31/10/2026;2362,70 EUR`,
  '',
  "Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise;",
  ...rows.map((r) => r.join(';') + ';'),
  '',
].join('\r\n'), 'latin1'));

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
  await page.getByRole('button', { name: /^Import 5/ }).click();
  await page.getByText('Import done').waitFor();

  // 1. Tick one, open its similar operations, tick them all, back to the selection
  await nav('Overview');
  await page.getByRole('button', { name: /^Categorize \d+ operation/ }).click();
  await page.getByTestId('selbar').waitFor();
  r.todo = await page.locator('.tx .name').allInnerTexts();
  r.noLinkBefore = await page.getByTestId('pick-similar').count();
  await page.locator('.tx').filter({ hasText: 'Chez Test Lili' }).first().click();
  r.linkAfter = await page.getByTestId('pick-similar').count();
  await shot('110_pick_similar_link');
  await page.getByTestId('pick-similar').click();
  const picker = page.getByTestId('similar-picker');
  await picker.waitFor();
  r.pickerRows = await picker.locator('.tx .name').allInnerTexts();
  await picker.getByRole('button', { name: 'Tick all' }).click();
  await shot('111_similar_picker');
  r.pickerDone = await picker.getByRole('button', { name: /^Done/ }).innerText();
  await picker.getByRole('button', { name: /^Done/ }).click();
  r.selbarAfter = await page.getByTestId('selbar').locator('strong').innerText();

  // 2. A new category, made from the selection bar, applied to the three
  await page.getByLabel('Category for the selected operations').selectOption('__new');
  await page.getByTestId('new-category').waitFor();
  await page.getByLabel('Name of the new category').fill('Snacks');
  await page.getByTestId('new-category').getByRole('button', { name: 'Add' }).click();
  r.bulkValue = await page.getByLabel('Category for the selected operations').locator('option:checked').innerText();
  await shot('112_new_category_bulk');
  await page.getByTestId('selbar').getByRole('button', { name: 'Apply' }).click();
  r.toast = await page.locator('.toast').innerText();
  r.todoAfter = await page.locator('.tx .name').allInnerTexts();
  await page.getByRole('button', { name: 'Done' }).click();

  // 3. Settings: add, rename and delete
  await nav('Overview');
  await page.getByRole('button', { name: 'Settings' }).click();
  const card = page.getByTestId('categories-card');
  await card.getByLabel('New category name').fill('Pets');
  await card.getByRole('button', { name: 'Add' }).click();
  r.hasPets = await card.getByRole('button', { name: /^Pets/ }).count();
  await card.getByRole('button', { name: /^Restaurants and bars/ }).click();
  await card.getByTestId('category-edit').locator('input').fill('Eating out');
  await card.getByTestId('category-edit').locator('input').press('Tab');
  r.renamed = await card.getByRole('button', { name: /^Eating out/ }).count();
  await card.getByRole('button', { name: /^Snacks/ }).click();
  await card.getByRole('button', { name: 'Merge into another' }).click();
  const merge = card.getByTestId('merge-panel');
  r.mergeOptions = await merge.getByLabel('Merge into').locator('option').allInnerTexts();
  await merge.getByLabel('Merge into').selectOption('groceries');
  r.mergeText = await merge.innerText();
  await shot('114_merge_category');
  await merge.getByRole('button', { name: 'Merge into Groceries' }).click();
  r.toast2 = await page.locator('.toast').innerText();
  r.snacksGone = (await card.getByRole('button', { name: /^Snacks/ }).count()) === 0;
  r.groceriesCount = await card.getByRole('button', { name: /^Groceries/ }).innerText();
  // delete: operations become not categorized
  await card.getByRole('button', { name: /^Pets/ }).click();
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  r.deleteText = await card.getByTestId('delete-panel').innerText();
  await card.getByRole('button', { name: 'Delete Pets' }).click();
  r.petsGone = (await card.getByRole('button', { name: /^Pets/ }).count()) === 0;

  // 4. The operations followed, and the operation sheet offers a new category too
  await nav('Operations');
  await page.getByLabel('Category').selectOption('');
  r.subs = await page.locator('.tx .sub').allInnerTexts();
  await page.locator('.tx').filter({ hasText: 'Kiosque' }).first().click();
  r.detailOptions = (await page.locator('#cat option').allInnerTexts()).slice(-2);

  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
