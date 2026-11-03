// Transfers between your accounts shown on Overview, Spending and Operations, and the account
// filter in Spending and Operations, on the demo data (invented)
// Run: node e2e/run8.cjs http://localhost:4173/e2e/
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
  const nav = (t) => page.locator('nav').getByText(t, { exact: true }).click();
  const shot = (n, full = false) => page.screenshot({ path: path.join(shots, n + '.png'), fullPage: full });
  const hint = () => page.locator('.page .hint').first().innerText();
  const r = {};
  await page.goto(process.argv[2]);
  await page.getByText('Try it with invented demo data').click();
  await page.getByText('Top spending').waitFor();

  // Overview: the amount moved between accounts this month, tap to see the operations
  r.overviewMoved = (await page.getByTestId('moved-between').count()) ? await page.getByTestId('moved-between').innerText() : null;

  // Spending: transfers card and account filter
  await nav('Spending');
  const card = page.getByTestId('transfers-card');
  r.transfersAll = await card.innerText();
  r.heroAll = await page.locator('.hero').innerText();
  await shot('80_spending_transfers', true);
  const chips = page.getByRole('group', { name: 'Accounts in this view' });
  r.chips = await chips.getByRole('button').allInnerTexts();
  await chips.getByRole('button').nth(1).click();
  r.heroFirst = await page.locator('.hero').innerText();
  r.transfersFirst = await card.innerText();
  await chips.getByRole('button').nth(2).click();
  r.heroBoth = await page.locator('.hero').innerText(); // both picked is all accounts
  r.allOnAgain = await chips.getByRole('button', { name: 'All accounts' }).getAttribute('aria-pressed');
  await chips.getByRole('button').nth(2).click();
  r.heroSecond = await page.locator('.hero').innerText();
  await shot('81_spending_one_account');

  // Tap a transfer row: Operations filtered to transfers
  await chips.getByRole('button', { name: 'All accounts' }).click();
  const rows = card.locator('button.flow');
  if (await rows.count()) {
    await rows.first().click();
    r.opsCategory = await page.getByLabel('Category').inputValue();
    r.opsHint = await page.locator('.page p.hint').allInnerTexts();
    r.opsFirstSub = await page.locator('.tx .sub').first().innerText();
    await shot('82_operations_transfers');
  }

  // Operations: several accounts at once
  await page.getByLabel('Category').selectOption('');
  const opsChips = page.getByRole('group', { name: 'Accounts' });
  r.opsAll = (await page.locator('.page p.hint').first().innerText()).split(' · ')[0];
  await opsChips.getByRole('button').nth(1).click();
  r.opsOne = (await page.locator('.page p.hint').first().innerText()).split(' · ')[0];
  await opsChips.getByRole('button').nth(2).click();
  r.opsTwo = (await page.locator('.page p.hint').first().innerText()).split(' · ')[0];

  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
