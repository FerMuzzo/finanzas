// Manual entries, duplicate warnings, merging with the bank file, possible duplicates, account colors
const { chromium, devices } = require('playwright');
const path = require('path');
const shots = path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const shot = (n, full = false) => page.screenshot({ path: path.join(shots, n + '.png'), fullPage: full });
  const nav = (t) => page.locator('nav').getByText(t, { exact: true }).click();
  const r = {};

  await page.goto(process.argv[2]);
  r.demoButtonInRealBuild = await page.getByText('Try it with invented demo data').count();
  await page.getByText('Create my vault').click();
  await page.fill('#p1', 'violet river paper lamp');
  await page.fill('#p2', 'violet river paper lamp');
  await page.getByRole('button', { name: 'Create the vault' }).click();
  await page.getByTestId('recovery-key').waitFor({ timeout: 20000 });
  await page.getByLabel('I have written down my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Import with a chosen color
  await page.setInputFiles('input[type=file]', path.join(__dirname, 'sg_test.csv'));
  await page.getByText('Color in the operations list').waitFor();
  await page.getByRole('radio', { name: 'Account color 7' }).click();
  await shot('30_import_color');
  await page.getByRole('button', { name: /^Import 8/ }).click();
  await page.getByText('Import done').waitFor();

  // Manual entry that already exists: warning
  await nav('Overview');
  await page.getByRole('button', { name: 'Add an expense or income' }).click();
  await page.fill('#amt', '48');
  await page.fill('#desc', 'Asso');
  await page.fill('#dt', '2026-10-29');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await page.getByTestId('similar-warning').waitFor();
  await shot('31_manual_duplicate_warning');
  await page.getByRole('button', { name: "Don't add" }).click();

  // New manual entry, merged later by the bank file
  await page.getByRole('button', { name: 'Add an expense or income' }).click();
  await page.fill('#amt', '12,30');
  await page.fill('#desc', 'pharmacie');
  r.suggestedCategory = await page.$eval('#cat2', (e) => e.value);
  await page.fill('#dt', '2026-10-31');
  await page.fill('#nt', 'cold medicine');
  await shot('32_manual_form');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await page.getByText('Expense added').waitFor();

  // Cash account
  await page.getByRole('button', { name: 'Add an expense or income' }).click();
  await page.fill('#amt', '3,20');
  await page.fill('#desc', 'Boulangerie');
  await page.selectOption('#acc2', '__cash');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await page.getByText('Expense added').waitFor();

  await nav('Operations');
  await page.getByText('Pharmacie').first().waitFor();
  r.manualBadges = await page.getByText('added by hand', { exact: true }).count();
  await shot('33_operations_colors');

  // Second file: merges the manual pharmacy entry and flags a possible duplicate
  await page.getByRole('button', { name: 'Import a bank file' }).first().click();
  await page.setInputFiles('input[type=file]', path.join(__dirname, 'sg_test2.csv'));
  await page.getByText(/in this file/).waitFor();
  r.possibleShown = await page.getByText(/possible duplicate/).count();
  await shot('34_import_merge', true);
  await page.getByRole('button', { name: /^Import 1/ }).click();
  await page.getByText('Import done').waitFor();
  r.resultText = await page.locator('.card p').first().textContent();
  await nav('Operations');
  await page.getByPlaceholder('Search a name, a word, a note').fill('pharmacie');
  await page.waitForTimeout(200);
  r.pharmacyRows = await page.locator('.tx').count();
  await page.locator('.tx').first().click();
  r.mergedSource = await page.getByText('Added by hand, confirmed by the bank file').count();
  r.noteKept = await page.$eval('#note', (e) => e.value);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByPlaceholder('Search a name, a word, a note').fill('airport');
  await page.waitForTimeout(200);
  r.airportRows = await page.locator('.tx').count();

  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
