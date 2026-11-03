// Phone test on the real build (real security policy): PDF statements, an account added by hand,
// a transfer recorded in it, and the protected balance correction. Invented data only.
// Run: node e2e/run7.cjs http://localhost:4173/finanzas/
const { chromium, devices } = require('playwright');
const path = require('path');
const shots = path.join(__dirname, 'shots');
const pdfDir = path.join(__dirname, '..', 'test', 'pdf');
const PASS = 'violet river paper lamp';

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
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const r = {};
  await page.goto(process.argv[2]);
  await page.getByText('Create my vault').click();
  await page.fill('#p1', PASS);
  await page.fill('#p2', PASS);
  await page.getByRole('button', { name: 'Create the vault' }).click();
  await page.getByTestId('recovery-key').waitFor({ timeout: 20000 });
  await page.getByLabel('I have written down my recovery key').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.setInputFiles('input[type=file]', path.join(__dirname, 'sg_test.csv'));
  await page.getByRole('button', { name: /^Import 8/ }).click();
  await page.getByText('Import done').waitFor();

  // Two monthly PDF statements at once
  await page.locator('nav').getByText('Overview', { exact: true }).click();
  await page.getByRole('button', { name: 'Import' }).first().click();
  await page.setInputFiles('input[type=file]', [path.join(pdfDir, 'statement_sg_like_april.pdf'), path.join(pdfDir, 'statement_sg_like.pdf')]);
  await page.getByTestId('pdf-rows').waitFor({ timeout: 30000 });
  r.checks = await page.getByTestId('pdf-check').allInnerTexts();
  r.rows = await page.getByTestId('pdf-rows').locator('li').count();
  r.target = await page.locator('#target').inputValue();
  r.proposedName = await page.locator('#acc').inputValue();
  await page.screenshot({ path: path.join(shots, '70_pdf_review.png'), fullPage: true });
  // flip one and flip it back: the check turns red then green again
  await page.getByRole('button', { name: /Swap money in and out/ }).first().click();
  r.mismatchAfterFlip = (await page.getByTestId('pdf-check').first().innerText()).includes('do not add up');
  await page.getByRole('button', { name: /Swap money in and out/ }).first().click();
  await page.getByRole('button', { name: /^Import 8/ }).click();
  await page.getByText('Import done').waitFor();
  r.importDone = await page.locator('.card').filter({ hasText: 'Import done' }).innerText();

  // Same statements again: nothing new
  await page.locator('nav').getByText('Overview', { exact: true }).click();
  await page.getByRole('button', { name: 'Import' }).first().click();
  await page.setInputFiles('input[type=file]', [path.join(pdfDir, 'statement_sg_like.pdf')]);
  await page.getByTestId('pdf-rows').waitFor({ timeout: 30000 });
  r.againTarget = await page.locator('#target').locator('option:checked').innerText();
  r.againButton = await page.getByRole('button', { name: /Nothing new|Import/ }).last().innerText();
  r.againNotice = await page.getByText(/already imported/).innerText();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Overview: the savings account and its balance from the statement
  await page.locator('nav').getByText('Overview', { exact: true }).click();
  const acc = page.getByRole('button', { name: /Livret A/ });
  r.overviewLivret = await acc.innerText();
  await acc.click();
  await page.getByTestId('balance-card').waitFor();
  await page.screenshot({ path: path.join(shots, '71_account_balance.png') });
  await page.getByRole('button', { name: 'Correct the balance' }).click();
  await page.fill('#fix-amt', '5 200,00');
  await page.getByRole('button', { name: 'Review' }).click();
  r.review = await page.getByTestId('fix-review').innerText();
  await page.fill('#fix-pass', 'not my passphrase');
  await page.getByRole('button', { name: 'Confirm with passphrase' }).click();
  await page.getByText('This passphrase is not correct.').waitFor({ timeout: 20000 });
  r.wrongPassRefused = true;
  await page.screenshot({ path: path.join(shots, '72_balance_review.png') });
  await page.fill('#fix-pass', PASS);
  await page.getByRole('button', { name: 'Confirm with passphrase' }).click();
  await page.getByRole('button', { name: 'Correct the balance' }).waitFor({ timeout: 20000 });
  r.balanceCard = await page.getByTestId('balance-card').innerText();
  await page.getByRole('button', { name: 'Close' }).last().click();

  // An account added by hand, then a transfer recorded in it from an operation
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Add an account' }).click();
  await page.fill('#na-name', 'LDDS');
  await page.fill('#na-bal', '1 000,00');
  await page.fill('#na-date', '2026-10-01');
  await page.screenshot({ path: path.join(shots, '73_add_account.png'), fullPage: true });
  await page.getByRole('button', { name: 'Add the account' }).click();
  await page.locator('nav').getByText('Operations', { exact: true }).click();
  await page.getByText('Mme Dupont A Et Mr Martin J').first().click();
  await page.getByRole('button', { name: 'Moved to another of my accounts' }).click();
  await page.getByTestId('record-targets').getByText('LDDS').click();
  await page.screenshot({ path: path.join(shots, '74_record_confirm.png') });
  await page.getByTestId('record-confirm').click();
  r.afterRecord = await page.locator('.notice.ok').first().innerText();
  await page.getByRole('button', { name: 'Close' }).last().click();
  await page.locator('nav').getByText('Overview', { exact: true }).click();
  r.overviewLdds = await page.getByRole('button', { name: /LDDS/ }).innerText();
  r.overviewSaved = await page.getByText(/Moved to savings/).count();

  // Fingerprint as the confirmation for a balance correction
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.fill('#bp', PASS);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Fingerprint unlock is on').waitFor({ timeout: 20000 });
  await page.locator('nav').getByText('Overview', { exact: true }).click();
  await page.getByRole('button', { name: /LDDS/ }).click();
  await page.getByRole('button', { name: 'Correct the balance' }).click();
  await page.fill('#fix-amt', '1900');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Confirm with fingerprint' }).click();
  await page.getByRole('button', { name: 'Correct the balance' }).waitFor({ timeout: 20000 });
  r.lddsAfterBio = await page.getByTestId('balance-card').innerText();
  await page.screenshot({ path: path.join(shots, '75_after_bio.png') });

  console.log(JSON.stringify({ ...r, errors }, null, 1));
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
