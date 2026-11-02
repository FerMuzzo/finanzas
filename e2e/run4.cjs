// Encrypted copy in a file the user chooses, with the file picker simulated
const { chromium, devices } = require('playwright');
const path = require('path');
const shots = path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript(() => {
    window.__writes = [];
    window.showSaveFilePicker = async (opts) => {
      const name = opts.suggestedName;
      return {
        name, kind: 'file',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        createWritable: async () => {
          const chunks = [];
          return {
            write: async (d) => { chunks.push(typeof d === 'string' ? d : await d.text()); },
            close: async () => { window.__writes.push({ name, content: chunks.join('') }); },
          };
        },
      };
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const nav = (t) => page.locator('nav').getByText(t, { exact: true }).click();
  const r = {};
  await page.goto(process.argv[2]);
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

  await nav('Overview');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Choose a location' }).click();
  await page.getByText('Updated after every change').waitFor();
  await page.screenshot({ path: path.join(shots, '40_settings_location.png') });
  const first = await page.evaluate(() => window.__writes.length);

  await nav('Overview');
  await page.getByRole('button', { name: 'Add an expense or income' }).click();
  await page.fill('#amt', '7,80');
  await page.fill('#desc', 'Marche Victor Hugo');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await page.getByText('Expense added').waitFor();
  await page.waitForTimeout(800);
  const writes = await page.evaluate(() => window.__writes);
  r.copyWrites = writes.filter((w) => w.name === 'finanzas-data.json').length;
  r.wroteAfterChange = writes.length > first;
  const last = JSON.parse(writes[writes.length - 1].content);
  r.format = last.format;
  r.readableInCopy = ['Marche', 'MARCHE', 'Airport', 'DGFIP', '2400'].filter((w) => writes[writes.length - 1].content.includes(w));

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Save backup' }).click();
  await page.getByText(/Backup saved as finanzas-backup/).waitFor();
  r.backupWritten = (await page.evaluate(() => window.__writes.map((w) => w.name))).some((n) => n.startsWith('finanzas-backup'));
  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
