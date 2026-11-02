const { chromium, devices } = require('playwright');
const path = require('path');
const shots = path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  // Use the download path for backups in this test
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  const url = process.argv[2];
  const goSettings = async () => { await page.locator('nav').getByText('Overview', { exact: true }).click(); await page.getByRole('button', { name: 'Settings' }).click(); };
  const shot = (n) => page.screenshot({ path: path.join(shots, n + '.png'), fullPage: false });

  await page.goto(url);
  await page.getByText('Create my vault').waitFor();
  await shot('01_welcome');
  await page.getByText('Create my vault').click();
  await page.fill('#p1', 'violet river paper lamp');
  await page.fill('#p2', 'violet river paper lamp');
  await page.getByRole('button', { name: 'Create the vault' }).click();
  const rk = page.getByTestId('recovery-key');
  await rk.waitFor({ timeout: 20000 });
  const recovery = (await rk.textContent()).trim();
  await shot('02_recovery');
  await page.getByLabel('I have written down my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Import
  await page.setInputFiles('input[type=file]', path.join(__dirname, 'sg_test.csv'));
  await page.getByText('Months in this file').waitFor();
  await shot('03_import_preview');
  const ok = await page.getByText('All 8 operations announced by the bank were read.').count();
  await page.getByRole('button', { name: /^Import 8/ }).click();
  await page.getByText('Import done').waitFor();
  // reimport same file: nothing new
  await page.setInputFiles('input[type=file]', path.join(__dirname, 'sg_test.csv'));
  await page.getByText('already imported on').waitFor();
  const nothingNew = await page.getByRole('button', { name: 'Nothing new' }).isDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Home
  await page.getByRole('button', { name: 'Overview' }).last().click();
  await page.getByText('Top spending').waitFor();
  await shot('04_home');

  // Operations and details
  await page.locator('nav').getByText('Operations', { exact: true }).click();
  await page.getByText('Airport Shop Exemple').waitFor();
  await shot('05_operations');
  await page.getByText('Airport Shop Exemple').click();
  await page.getByText('Original amount').waitFor();
  await page.selectOption('#cat', 'travel');
  await shot('06_detail');
  await page.getByRole('button', { name: 'Close' }).click();

  // Reload: data must persist, encrypted, behind the passphrase
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByRole('heading', { name: 'Unlock' }).waitFor();
  await page.fill('#pass', 'wrong passphrase');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByText('Wrong passphrase.').waitFor();
  await page.fill('#pass', 'violet river paper lamp');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByText('Top spending').waitFor();
  await page.locator('nav').getByText('Operations', { exact: true }).click(); const travelKept = await page.getByText('Travel').count();

  // What is actually stored in IndexedDB must not contain readable text
  const stored = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('finanzas');
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', 'readonly');
      const g = tx.objectStore('kv').get('data');
      g.onsuccess = () => res(JSON.stringify(g.result));
    };
  }));
  const leaks = ['Airport', 'DGFIP', 'MONOPRIX', 'Monoprix', '2400'].filter((w) => stored.includes(w));

  // Backup download
  await goSettings();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save backup' }).click()]);
  const backupPath = path.join(__dirname, 'backup.json');
  await dl.saveAs(backupPath);
  await shot('07_settings');

  // Recovery key path
  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.getByText('Forgot it? Use the recovery key').click();
  await page.fill('#rk', recovery.toLowerCase());
  await page.fill('#np', 'new orange garden bicycle');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByText('Top spending').waitFor({ timeout: 20000 });

  // Erase, then restore from the backup with the old passphrase
  await goSettings();
  await page.fill('input[placeholder=ERASE]', 'ERASE');
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await page.getByText('Create my vault').waitFor();
  await page.getByText('Open a backup or copy file').click();
  await page.setInputFiles('input[type=file]', backupPath);
  await page.fill('#secret', 'violet river paper lamp');
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.getByText('Top spending').waitFor({ timeout: 20000 });
  const restoredOps = await page.evaluate(() => document.body.innerText.includes('Société Générale'));

  // Demo
  await goSettings();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.goto(url);
  await page.evaluate(() => indexedDB.deleteDatabase('finanzas'));
  await page.reload();
  await page.getByText('Try it with invented demo data').click();
  await page.getByText('Top spending').waitFor();
  await shot('08_demo_home');
  await page.locator('nav').getByText('Operations', { exact: true }).click();
  await page.waitForTimeout(300);
  await shot('09_demo_operations');

  console.log(JSON.stringify({ ok, nothingNew, travelKept, leaks, restoredOps, recovery: recovery.length, errors }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
