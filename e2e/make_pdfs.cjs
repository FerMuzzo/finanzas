// Builds synthetic monthly statement PDFs with invented names, amounts and references, in three
// layouts seen in French bank statements. Used by the unit tests and the phone tests.
// Run: node e2e/make_pdfs.cjs  (writes test/pdf/*.pdf)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'test', 'pdf');
fs.mkdirSync(OUT, { recursive: true });

const css = `
  body { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; margin: 0; }
  .page { padding: 14mm 12mm; }
  h1 { font-size: 14pt; margin: 0 0 4mm; }
  .meta { margin-bottom: 6mm; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; border-bottom: 1px solid #444; padding: 2px 4px; font-size: 8.5pt; }
  td { padding: 2px 4px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; width: 24mm; }
  .d { width: 16mm; white-space: nowrap; }
  .lbl div + div { color: #333; }
  tr.sum td { font-weight: bold; border-top: 1px solid #444; }
  .footer { position: fixed; bottom: 8mm; left: 12mm; font-size: 7pt; color: #666; }
  .break { page-break-before: always; }
`;

function sgLike() {
  // Date | Valeur | Nature de l'opération | Débit | Crédit, full dates, multi line labels, two pages
  const head = `<tr><th class="d">Date</th><th class="d">Valeur</th><th>Nature de l'opération</th><th class="num">Débit</th><th class="num">Crédit</th></tr>`;
  const rows1 = [
    ['02/03/2026', '02/03/2026', ['VIR RECU 9990001', 'DE: TEST PERSON', 'MOTIF: EPARGNE MARS'], '', '200,00'],
    ['05/03/2026', '05/03/2026', ['VIR PERM 1234', 'POUR: COMPTE TEST'], '', '150,00'],
    ['12/03/2026', '12/03/2026', ['RETRAIT VERS COMPTE COURANT'], '1 000,00', ''],
    ['20/03/2026', '20/03/2026', ['VIR RECU 9990002', 'DE: TEST PERSON'], '', '75,50'],
  ];
  const rows2 = [
    ['28/03/2026', '28/03/2026', ['VIR RECU 9990003', 'DE: TEST PERSON', 'MOTIF: CADEAU'], '', '1 250,00'],
    ['31/03/2026', '31/03/2026', ['RETRAIT VERS COMPTE COURANT'], '40,00', ''],
  ];
  const tr = (r) =>
    `<tr><td class="d">${r[0]}</td><td class="d">${r[1]}</td><td class="lbl">${r[2].map((l) => `<div>${l}</div>`).join('')}</td><td class="num">${r[3]}</td><td class="num">${r[4]}</td></tr>`;
  return `<html><head><style>${css}</style></head><body>
  <div class="page">
    <h1>RELEVÉ DE COMPTE D'ÉPARGNE</h1>
    <div class="meta">TEST BANQUE EXEMPLE · LIVRET A<br>Compte n° 00099 00000099999 · IBAN FR76 9999 9999 9900 0000 0099 999<br>du 1er mars 2026 au 31 mars 2026</div>
    <table>${head}
      <tr><td></td><td></td><td><b>SOLDE PRÉCÉDENT AU 28/02/2026</b></td><td class="num"></td><td class="num">4 500,00</td></tr>
      ${rows1.map(tr).join('')}
    </table>
    <div class="footer">Document fictif pour test · page 1/2</div>
  </div>
  <div class="page break">
    <table>${head}
      ${rows2.map(tr).join('')}
      <tr class="sum"><td></td><td></td><td>TOTAUX DES MOUVEMENTS</td><td class="num">1 040,00</td><td class="num">1 675,50</td></tr>
      <tr class="sum"><td></td><td></td><td>NOUVEAU SOLDE AU 31/03/2026</td><td class="num"></td><td class="num">5 135,50</td></tr>
    </table>
    <div class="footer">Document fictif pour test · page 2/2</div>
  </div></body></html>`;
}

function sgLikeApril() {
  // The next month of the same invented account, on one page
  const head = `<tr><th class="d">Date</th><th class="d">Valeur</th><th>Nature de l'opération</th><th class="num">Débit</th><th class="num">Crédit</th></tr>`;
  const rows = [
    ['02/04/2026', '02/04/2026', ['VIR RECU 9990004', 'DE: TEST PERSON', 'MOTIF: EPARGNE AVRIL'], '', '200,00'],
    ['15/04/2026', '15/04/2026', ['RETRAIT VERS COMPTE COURANT'], '300,00', ''],
  ];
  const tr = (r) =>
    `<tr><td class="d">${r[0]}</td><td class="d">${r[1]}</td><td class="lbl">${r[2].map((l) => `<div>${l}</div>`).join('')}</td><td class="num">${r[3]}</td><td class="num">${r[4]}</td></tr>`;
  return `<html><head><style>${css}</style></head><body><div class="page">
    <h1>RELEVÉ DE COMPTE D'ÉPARGNE</h1>
    <div class="meta">TEST BANQUE EXEMPLE · LIVRET A<br>Compte n° 00099 00000099999 · IBAN FR76 9999 9999 9900 0000 0099 999<br>du 1er avril 2026 au 30 avril 2026</div>
    <table>${head}
      <tr><td></td><td></td><td><b>SOLDE PRÉCÉDENT AU 31/03/2026</b></td><td class="num"></td><td class="num">5 135,50</td></tr>
      ${rows.map(tr).join('')}
      <tr class="sum"><td></td><td></td><td>TOTAUX DES MOUVEMENTS</td><td class="num">300,00</td><td class="num">200,00</td></tr>
      <tr class="sum"><td></td><td></td><td>NOUVEAU SOLDE AU 30/04/2026</td><td class="num"></td><td class="num">5 035,50</td></tr>
    </table>
    <div class="footer">Document fictif pour test · page 1/1</div>
  </div></body></html>`;
}

function hbLike() {
  // Date | Nature des opérations | Valeur | Débit | Crédit, short dates "dd.mm", across a year end
  const head = `<tr><th class="d">Date</th><th>Nature des opérations</th><th class="d">Valeur</th><th class="num">Débit</th><th class="num">Crédit</th></tr>`;
  const rows = [
    ['18.12', ['VIREMENT SEPA RECU DE TEST PERSON', 'MOTIF EPARGNE'], '18.12', '', '300,00'],
    ['31.12', ['INTERETS CREDITEURS 2025'], '31.12', '', '61,37'],
    ['06.01', ['VIREMENT SEPA EMIS VERS TEST PERSON', 'MOTIF RETOUR'], '06.01', '500,00', ''],
    ['10.01', ['VIREMENT SEPA RECU DE TEST PERSON'], '10.01', '', '300,00'],
  ];
  const tr = (r) =>
    `<tr><td class="d">${r[0]}</td><td class="lbl">${r[1].map((l) => `<div>${l}</div>`).join('')}</td><td class="d">${r[2]}</td><td class="num">${r[3]}</td><td class="num">${r[4]}</td></tr>`;
  return `<html><head><style>${css}</style></head><body><div class="page">
    <h1>RELEVE DE COMPTE</h1>
    <div class="meta">EXEMPLE BANK! · LIVRET EPARGNE<br>du 15.12.2025 au 14.01.2026<br>IBAN : FR76 8888 8888 8800 0000 0088 888</div>
    <table>${head}
      <tr><td></td><td><b>SOLDE CREDITEUR AU 14.12.2025</b></td><td></td><td class="num"></td><td class="num">2.000,00</td></tr>
      ${rows.map(tr).join('')}
      <tr class="sum"><td></td><td>TOTAL DES OPERATIONS</td><td></td><td class="num">500,00</td><td class="num">661,37</td></tr>
      <tr class="sum"><td></td><td>SOLDE CREDITEUR AU 14.01.2026</td><td></td><td class="num"></td><td class="num">2.161,37</td></tr>
    </table>
    <div class="footer">Document fictif pour test · page 1/1</div>
  </div></body></html>`;
}

function signedLike() {
  // Date | Libellé | Montant, signed amounts, closing balance stated in a sentence
  const rows = [
    ['03/04/2026', 'VERSEMENT DEPUIS COMPTE TEST', '+250,00'],
    ['15/04/2026', 'RETRAIT VERS COMPTE TEST', '-100,00'],
    ['15/04/2026', 'RETRAIT VERS COMPTE TEST', '-100,00'],
    ['30/04/2026', 'VERSEMENT DEPUIS COMPTE TEST', '+250,00'],
  ];
  return `<html><head><style>${css}</style></head><body><div class="page">
    <h1>Relevé mensuel</h1>
    <div class="meta">Compte sur livret · Période du 01/04/2026 au 30/04/2026</div>
    <table><tr><th class="d">Date</th><th>Libellé</th><th class="num">Montant</th></tr>
      ${rows.map((r) => `<tr><td class="d">${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}
    </table>
    <p>Solde au 30/04/2026 : 3 300,00 €</p>
  </div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, html] of [
    ['statement_sg_like.pdf', sgLike()],
    ['statement_sg_like_april.pdf', sgLikeApril()],
    ['statement_hb_like.pdf', hbLike()],
    ['statement_signed.pdf', signedLike()],
  ]) {
    await page.setContent(html);
    await page.pdf({ path: path.join(OUT, name), format: 'A4', printBackground: true });
    console.log('wrote', name);
  }
  await browser.close();
})();
