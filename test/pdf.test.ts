// Reads the synthetic statements in test/pdf (invented names, amounts and references, made by
// e2e/make_pdfs.cjs) with the same pdf.js code the app uses.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdfPages } from '../src/core/pdfRead';
import { checkStatement, parsePdfStatement, type PdfPage } from '../src/core/pdfStatement';

async function load(name: string): Promise<PdfPage[]> {
  const bytes = new Uint8Array(readFileSync(join(__dirname, 'pdf', name)));
  return readPdfPages(pdfjs as never, bytes);
}

describe('PDF statements', () => {
  it('reads a two page statement with Débit and Crédit columns and multi line labels', async () => {
    const p = parsePdfStatement(await load('statement_sg_like.pdf'));
    expect(p.errors).toEqual([]);
    expect(p.hasColumns).toBe(true);
    expect(p.periodStart).toBe('2026-03-01');
    expect(p.periodEnd).toBe('2026-03-31');
    expect(p.rows.map((r) => [r.date, r.amount])).toEqual([
      ['2026-03-02', 20000],
      ['2026-03-05', 15000],
      ['2026-03-12', -100000],
      ['2026-03-20', 7550],
      ['2026-03-28', 125000],
      ['2026-03-31', -4000],
    ]);
    expect(p.rows[0].label).toBe('VIR RECU 9990001');
    expect(p.rows[0].detail).toBe('VIR RECU 9990001 DE: TEST PERSON MOTIF: EPARGNE MARS');
    expect(p.rows[4].detail).toContain('MOTIF: CADEAU');
    expect(p.rows[4].detail).not.toContain('Document');
    expect(p.opening).toEqual({ date: '2026-02-28', amount: 450000 });
    expect(p.closing).toEqual({ date: '2026-03-31', amount: 513550 });
    expect(p.totals).toEqual({ debit: 104000, credit: 167550 });
    expect(p.balance).toEqual({ date: '2026-03-31', amount: 513550, currency: 'EUR' });
    expect(p.proposedName).toBe('Livret A');
    expect(p.proposedType).toBe('savings');
    expect(p.last4).toBe('0999');
    expect(checkStatement(p).status).toBe('ok');
  });

  it('reads short dates across a year end, a value date column and the interest line', async () => {
    const p = parsePdfStatement(await load('statement_hb_like.pdf'));
    expect(p.errors).toEqual([]);
    expect(p.rows.map((r) => [r.date, r.amount, r.label])).toEqual([
      ['2025-12-18', 30000, 'VIREMENT SEPA RECU DE TEST PERSON'],
      ['2025-12-31', 6137, 'INTERETS CREDITEURS 2025'],
      ['2026-01-06', -50000, 'VIREMENT SEPA EMIS VERS TEST PERSON'],
      ['2026-01-10', 30000, 'VIREMENT SEPA RECU DE TEST PERSON'],
    ]);
    expect(p.opening?.amount).toBe(200000);
    expect(p.closing?.amount).toBe(216137);
    expect(p.closing?.date).toBe('2026-01-14');
    expect(checkStatement(p).status).toBe('ok');
    expect(p.proposedType).toBe('savings');
  });

  it('reads a single signed amount column and a closing balance written in a sentence', async () => {
    const p = parsePdfStatement(await load('statement_signed.pdf'));
    expect(p.errors).toEqual([]);
    expect(p.rows.map((r) => r.amount)).toEqual([25000, -10000, -10000, 25000]);
    expect(p.guessedSigns).toBe(0);
    expect(p.closing).toEqual({ date: '2026-04-30', amount: 330000 });
    expect(p.opening).toBeUndefined();
    expect(checkStatement(p).status).toBe('unknown');
  });

  it('flags operations that do not add up to the balances', async () => {
    const p = parsePdfStatement(await load('statement_sg_like.pdf'));
    const amounts = p.rows.map((r) => r.amount);
    amounts[2] = -amounts[2];
    expect(checkStatement(p, amounts).status).toBe('mismatch');
  });

  it('works on positioned text without a PDF: words split in separate items, no header', () => {
    const items = (y: number, parts: [string, number][]) => parts.map(([str, x]) => ({ str, x, y, w: str.length * 5, h: 10 }));
    const p = parsePdfStatement([
      {
        items: [
          ...items(800, [['Relevé', 30], ['du', 70], ['01/05/2026', 90], ['au', 150], ['31/05/2026', 170]]),
          ...items(760, [['04/05', 30], ['VERSEMENT', 70], ['MENSUEL', 120], ['1', 400], ['000,00', 408]]),
          ...items(745, [['22/05', 30], ['RETRAIT', 70], ['50,00', 405]]),
        ],
      },
    ]);
    expect(p.rows.map((r) => [r.date, r.amount])).toEqual([
      ['2026-05-04', 100000],
      ['2026-05-22', -5000],
    ]);
    expect(p.guessedSigns).toBe(2);
  });
});

describe('PDF statements written cell by cell in a standard font', () => {
  it('reads a current account statement over two pages', async () => {
    const { buildPdf } = await import('./pdfBuilder');
    const D = 40, V = 92, L = 145, DEB = 470, CRE = 550;
    const head = (y: number) => [
      { x: D, y, text: 'Date', size: 8 },
      { x: V, y, text: 'Valeur', size: 8 },
      { x: L, y, text: "Nature de l'opération", size: 8 },
      { x: DEB, y, text: 'Débit', size: 8, right: true },
      { x: CRE, y, text: 'Crédit', size: 8, right: true },
    ];
    const op = (y: number, date: string, label: string, debit = '', credit = '') => [
      { x: D, y, text: date },
      { x: V, y, text: date },
      { x: L, y, text: label },
      ...(debit ? [{ x: DEB, y, text: debit, right: true }] : []),
      ...(credit ? [{ x: CRE, y, text: credit, right: true }] : []),
    ];
    const bytes = buildPdf([
      [
        { x: 40, y: 800, text: 'Société Générale', size: 12 },
        { x: 40, y: 785, text: 'RELEVÉ DE COMPTE' },
        { x: 40, y: 770, text: 'Compte courant' },
        { x: 40, y: 755, text: 'du 01/03/2026 au 31/03/2026' },
        ...head(700),
        { x: L, y: 686, text: 'SOLDE PRÉCÉDENT AU 28/02/2026' },
        { x: CRE, y: 686, text: '1 250,40', right: true },
        ...op(672, '02/03/2026', 'CARTE X1234 28/02 BOULANGERIE TEST', '4,20'),
        ...op(648, '03/03/2026', 'PRLV SEPA OPERATEUR TEST', '29,99'),
        { x: L, y: 636, text: 'DE: OPERATEUR TEST' },
        { x: L, y: 624, text: 'ID: FR00ZZZ000000 MOTIF: FACTURE MARS' },
        ...op(612, '05/03/2026', 'VIR RECU 1112223', '', '2 100,00'),
        { x: L, y: 600, text: 'DE: EMPLOYEUR TEST' },
        ...op(588, '06/03/2026', 'VIR PERM 4445556', '150,00'),
        { x: L, y: 576, text: 'POUR: LIVRET TEST' },
        { x: 40, y: 30, text: 'Société Générale, document de test, page 1/2', size: 7 },
      ],
      [
        { x: 40, y: 800, text: 'RELEVÉ DE COMPTE (suite)' },
        ...head(770),
        ...op(756, '15/03/2026', 'CARTE X1234 14/03 SUPERMARCHE TEST', '86,35'),
        ...op(744, '20/03/2026', 'CARTE X1234 18/03 SUPERMARCHE TEST', '', '12,00'),
        ...op(732, '28/03/2026', 'FRAIS PAIEMENT HORS ZONE EURO', '1,50'),
        { x: L, y: 716, text: 'TOTAUX DES MOUVEMENTS' },
        { x: DEB, y: 716, text: '272,04', right: true },
        { x: CRE, y: 716, text: '2 112,00', right: true },
        { x: L, y: 700, text: 'NOUVEAU SOLDE AU 31/03/2026' },
        { x: CRE, y: 700, text: '3 090,36', right: true },
        { x: 40, y: 30, text: 'Société Générale, document de test, page 2/2', size: 7 },
      ],
    ]);
    const p = parsePdfStatement(await readPdfPages(pdfjs as never, bytes));
    expect(p.errors).toEqual([]);
    expect(p.bank).toBe('sg');
    expect(p.proposedType).toBe('checking');
    expect(p.rows.map((r) => [r.date, r.amount, r.label])).toEqual([
      ['2026-03-02', -420, 'CARTE X1234 28/02 BOULANGERIE TEST'],
      ['2026-03-03', -2999, 'PRLV SEPA OPERATEUR TEST'],
      ['2026-03-05', 210000, 'VIR RECU 1112223'],
      ['2026-03-06', -15000, 'VIR PERM 4445556'],
      ['2026-03-15', -8635, 'CARTE X1234 14/03 SUPERMARCHE TEST'],
      ['2026-03-20', 1200, 'CARTE X1234 18/03 SUPERMARCHE TEST'],
      ['2026-03-28', -150, 'FRAIS PAIEMENT HORS ZONE EURO'],
    ]);
    expect(p.rows[1].detail).toBe('PRLV SEPA OPERATEUR TEST DE: OPERATEUR TEST ID: FR00ZZZ000000 MOTIF: FACTURE MARS');
    expect(p.rows[3].detail).toBe('VIR PERM 4445556 POUR: LIVRET TEST');
    expect(checkStatement(p).status).toBe('ok');
    expect(p.totals).toEqual({ debit: 27204, credit: 211200 });
  });
});
