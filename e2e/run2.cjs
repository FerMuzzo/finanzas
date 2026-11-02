const { chromium, devices } = require('playwright');
const path = require('path');
const shots = path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = process.argv[2];
  const shot = (n, full = false) => page.screenshot({ path: path.join(shots, n + '.png'), fullPage: full });
  const nav = (t) => page.locator('nav').getByText(t, { exact: true }).click();
  const r = {};

  await page.goto(url);
  await page.getByText('Create my vault').click();
  await page.fill('#p1', 'violet river paper lamp');
  await page.fill('#p2', 'violet river paper lamp');
  await page.getByRole('button', { name: 'Create the vault' }).click();
  await page.getByTestId('recovery-key').waitFor({ timeout: 20000 });
  await page.getByLabel('I have written down my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.setInputFiles('input[type=file]', path.join(__dirname, 'sg_test.csv'));
  await page.getByRole('button', { name: /^Import 8/ }).click();
  await page.getByText('Import done').waitFor();
  await page.setInputFiles('input[type=file]', path.join(__dirname, 'hb_test.csv'));
  await page.getByText('Hello bank', { exact: true }).first().waitFor();
  await shot('20_import_hb');
  await page.getByRole('button', { name: /^Import 5/ }).click();
  await page.getByText('Import done').waitFor();
  r.linkedText = await page.getByText('1 transfers between your accounts recognized').count();

  await nav('Operations');
  await page.getByText('Le Petit Zinc').waitFor();
  r.ownTransferBadges = await page.getByText('own transfer').count();
  await page.getByText('Asso Exemple').click();
  await page.selectOption('#cat', 'shopping');
  await page.getByRole('button', { name: 'Close' }).click();

  await nav('Spending');
  await page.getByText('By category').waitFor();
  await page.getByRole('button', { name: /Oct 26/ }).click();
  await shot('21_spending', true);
  await nav('Overview');
  await page.getByText('Top spending').waitFor();
  await shot('22_home');

  // reload and unlock: everything persisted
  await page.waitForTimeout(600);
  await page.reload();
  await page.fill('#pass', 'violet river paper lamp');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByText('Top spending').waitFor();
  await nav('Operations');
  r.shoppingKept = await page.getByText('Shopping').count();

  // Demo: regular payments
  await nav('Overview');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.fill('input[placeholder=ERASE]', 'ERASE');
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await page.getByText('Try it with invented demo data').click();
  await page.getByText('Top spending').waitFor();
  await shot('23_demo_home');
  await nav('Regular');
  await page.getByText('To confirm').waitFor();
  await shot('24_regular_suggestions');
  r.suggestions = await page.getByRole('button', { name: 'Yes, follow it' }).count();
  await page.getByRole('button', { name: 'Not regular' }).last().click();
  await page.getByRole('button', { name: 'Confirm all' }).click();
  await page.getByText(/Followed/).waitFor();
  await shot('25_regular_followed', true);
  await nav('Spending');
  await page.getByText('By category').waitFor();
  await page.getByRole('tab', { name: 'Monthly average' }).click();
  await page.getByRole('button', { name: /Groceries/ }).click();
  await shot('26_spending_average', true);
  await nav('Operations');
  await page.waitForTimeout(200);
  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
