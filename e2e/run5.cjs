// Fingerprint unlock with a simulated phone passkey (Chrome virtual authenticator with PRF)
const { chromium, devices } = require('playwright');
const path = require('path');
const shots = path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
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

  await page.locator('nav').getByText('Overview', { exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.fill('#bp', 'not my passphrase');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('The passphrase is wrong.').waitFor({ timeout: 20000 });
  await page.fill('#bp', 'violet river paper lamp');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Fingerprint unlock is on').waitFor({ timeout: 20000 });
  await page.screenshot({ path: path.join(shots, '50_settings_fingerprint.png') });

  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.getByRole('button', { name: 'Unlock with fingerprint' }).waitFor();
  await page.screenshot({ path: path.join(shots, '51_unlock_fingerprint.png') });
  await page.getByRole('button', { name: 'Unlock with fingerprint' }).click();
  await page.getByText('Top spending').waitFor({ timeout: 20000 });
  r.unlockedByButton = true;

  // Restart: the prompt appears by itself
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByText('Top spending').waitFor({ timeout: 20000 });
  r.unlockedOnStart = true;

  // Passphrase still works
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.fill('#pass', 'violet river paper lamp');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByText('Top spending').waitFor({ timeout: 20000 });
  r.passphraseStillWorks = true;

  // Turn off
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Turn off' }).click();
  await page.getByRole('button', { name: 'Lock now' }).click();
  r.buttonGoneWhenOff = (await page.getByRole('button', { name: 'Unlock with fingerprint' }).count()) === 0;
  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
