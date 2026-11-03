// Similar operations, savings simulation and the Charts tab, on the demo data
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
  const r = {};
  await page.goto(process.argv[2]);
  await page.getByText('Try it with invented demo data').click();
  await page.getByText('Top spending').waitFor();

  // 1. Similar operations
  await nav('Operations');
  await page.getByPlaceholder('Search a name, a word, a note').fill('netflix');
  await page.locator('.tx').first().click();
  await page.getByRole('button', { name: 'Find similar operations' }).click();
  await page.getByText(/Similar to/).waitFor();
  r.similarCount = await page.locator('.stat .value').first().textContent();
  await page.locator('.bc .col').nth(2).click();
  await shot('60_similar_month', true);
  await page.getByRole('tab', { name: 'Each payment' }).click();
  await page.locator('.lc .hit').nth(3).click();
  r.lineReadout = await page.locator('.lc .readout').textContent();
  await shot('61_similar_each');
  await page.getByLabel('Similar amount').check();
  r.withAmount = await page.locator('.stat .value').first().textContent();
  await page.getByRole('button', { name: 'Close' }).click();

  // 2. Savings account simulation
  await nav('Overview');
  await page.getByRole('button', { name: /Hello bank savings/ }).click();
  await page.getByText('This is a savings account').waitFor();
  r.savingsChecked = await page.getByLabel('This is a savings account').isChecked();
  await page.fill('#rate', '2,4');
  await page.locator('#rate').blur();
  await page.getByRole('button', { name: '10 years' }).click();
  await page.waitForTimeout(200);
  r.after10 = await page.locator('.sheet .stat .value').first().textContent();
  r.interest10 = await page.locator('.sheet .stat .value').nth(2).textContent();
  await page.locator('.sheet .lc .hit').nth(5).click();
  await shot('62_savings', true);
  await page.getByRole('button', { name: 'Close' }).click();
  r.rateShownOnHome = await page.getByText(/Savings · 2,4%/).count();

  // 3. Charts tab
  await nav('Charts');
  await page.getByText('Month by month', { exact: false }).first().waitFor();
  await page.locator('.bc .col').nth(4).click();
  await shot('63_charts_default', true);
  for (const name of ['Top places', 'By account', 'Day of the week', 'Payment sizes', 'Spending pace', 'Account balances']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.waitForTimeout(300);
  await shot('64_charts_all', true);
  const stackedCard = page.locator('.card', { has: page.getByRole('heading', { name: 'Categories over time' }) });
  await stackedCard.locator('.bc .col').nth(3).click();
  await stackedCard.screenshot({ path: path.join(shots, '66_stacked.png') });
  r.stackedReadout = await stackedCard.locator('.readout').textContent();
  // drill down into one category
  await page.getByRole('button', { name: /^Groceries/ }).first().click();
  await page.waitForTimeout(200);
  r.filterCount = await page.getByText(/Filters \(1\)/).count();
  await page.getByRole('tab', { name: 'Income' }).click();
  await page.waitForTimeout(200);
  r.categoryClearedWhenSwitchingToIncome = (await page.getByText(/Filters \(1\)/).count()) === 0;
  await shot('65_charts_income', true);
  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
