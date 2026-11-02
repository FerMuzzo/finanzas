// Synthetic Société Générale files. Same structure as real exports, invented names and numbers.

export const SG_ROWS: string[][] = [
  ['30/10/2026', '000001 VIR PERM', '000001 VIR PERM POUR: MME DUPONT A ET MR MARTIN J REF: 900000000001 MOTIF: Loyer', '-845,00', 'EUR'],
  ['30/10/2026', 'VIR RECU    500001', 'VIR RECU    5000011111S DE: ACME RECHERCHE AGENT COMPTABLE MOTIF: ACME 4444444/0001 REF: 0000-000000AA-0000000000001', '35,00', 'EUR'],
  ['30/10/2026', 'CARTE X1234 29/10', 'CARTE X1234 29/10 ASSO EXEMPLE COMMERCE ELECTRONIQUE 900000000000001IOPD', '-48,00', 'EUR'],
  ['30/10/2026', 'FRAIS PAIEMENT HOR', 'FRAIS PAIEMENT HORS ZONE EURO CARTE X1234 27/10 20,00 USD CANADA', '-1,35', 'EUR'],
  ['29/10/2026', '000001 VIR INSTANT', '000001 VIR INSTANTANE EMIS LOGITEL POUR: Paul Exemple 29 10 BQ BOUS CPT 00099999999 DATE: 29/10/2026 17:49', '-9,50', 'EUR'],
  ['29/10/2026', 'CARTE X1234 27/10', 'CARTE X1234 27/10 AIRPORT SHOP EXEMPLE 20,00 USD CANADA 1 EUR=1,1500 USD 900000000000002IOPD', '-17,39', 'EUR'],
  ['28/10/2026', 'CARTE X1234 27/10', 'CARTE X1234 27/10 UBER *TRIP HELP.UBER.COM COMMERCE ELECTRONIQUE 900000000000003IOPD', '-18,40', 'EUR'],
  ['28/10/2026', 'CARTE X1234 27/10', 'CARTE X1234 27/10 CAFE S.A. - ESTACION DE 8,20 EUR ESPAGNE 900000000000004IOPD', '-8,20', 'EUR'],
  ['26/10/2026', 'PRELEVEMENT EUROPE', 'PRELEVEMENT EUROPEEN 9000000001 POUR CPTE DE:DGFIP IMPOT 000001 ID: FR00ZZZ000001 MOTIF: SOLDE IMPOT REVENUS 2025 N DE FACTU', '-210,00', 'EUR'],
  ['26/10/2026', 'CARTE X1234 24/10', 'CARTE X1234 24/10 SALON EXEMPLE 900000000000005IOPD', '-25,00', 'EUR'],
  ['26/10/2026', 'CARTE X1234 24/10', 'CARTE X1234 24/10 THE RED FOX 900000000000006IOPD', '-6,40', 'EUR'],
  ['26/10/2026', 'VIR RECU    500002', 'VIR RECU    5000022222S DE: ACME - AGENCE COMPTABLE CENTRE MOTIF: ACME PAYE 202610', '2400,00', 'EUR'],
  ['24/10/2026', '000001 VIR INSTANT', '000001 VIR INSTANTANE EMIS WERO POUR: LEA M IBAN: XXXXXXXXXXXXXXXXXXXXXXX9999 DATE: 24/10/2026 23:13', '-15,00', 'EUR'],
  ['23/10/2026', 'VIR RECU 500003333', 'VIR RECU 5000033333333 DE: M. JEAN MARTIN MOTIF: Remboursement', '150,00', 'EUR'],
  ['23/10/2026', 'FRAIS PAIEMENT HOR', 'FRAIS PAIEMENT HORS ZONE EURO CARTE X1234 20/10 30,00 EUR ETATS-UNIS D', '-1,10', 'EUR'],
];

/** As copied out of a spreadsheet: tabs, empty leading cells, leading zero lost, mojibake accents. */
export function sgSpreadsheetText(rows = SG_ROWS, count = rows.length): string {
  const mojibake = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  };
  const lines = [
    `\t\t\t123400009999\t03/05/2026\t30/10/2026\t${count}\t30/10/2026\t980,50 EUR\t`,
    '\t\t\t\t\t\t\t\t\t',
    '\t\t\t' + mojibake("Date de l'opération\tLibellé\tDétail de l'écriture\tMontant de l'opération\tDevise") + '\t\t',
    ...rows.map((r) => r.join('\t') + '\t\t\t\t\t'),
  ];
  return lines.join('\n');
}

/** Raw export as the bank would produce it: semicolons, protected account number, Windows 1252 bytes. */
export function sgRawBytes(rows = SG_ROWS, count = rows.length): Uint8Array {
  const text = [
    `="0000123400009999";03/05/2026;30/10/2026;${count};30/10/2026;980,50 EUR`,
    '',
    "Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise;",
    ...rows.map((r) => r.join(';') + ';'),
    '',
  ].join('\r\n');
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 256 ? c : 0x3f;
  }
  return out;
}

// Hello bank export, invented names. The original layout has tabs when copied from a
// spreadsheet and semicolons in the raw file.
export const HB_ROWS: string[][] = [
  ['02-11-2026', 'Revenus', 'Virement reçu', 'VIREMENT DE M. JEAN MARTIN - MOTIF : LOYER', '845', '', ''],
  ['28-10-2026', 'Revenus', 'Virement reçu', 'VIREMENT INSTANTANE RECU DE MLLE ANNE DUPONT  MOTIF: 000000000000000000000001', '80', '', ''],
  ['28-10-2026', 'Abonnements et Telephonie', 'Internet, TV', 'PAIEMENT CB NETFLIX DU 28/10/26 A AMSTERDAM - CARTE*1111', '-10.99', '', ''],
  ['27-10-2026', 'Loisirs et Sorties', 'Restaurants, bars', 'PAIEMENT CB LE PETIT ZINC DU 26/10/26 A TOULOUSE - CARTE*2222', '-42', '', ''],
  ['27-10-2026', 'Loisirs et Sorties', 'Sport', 'PRELEVEMENT FITNESS PARK DU 27/10/26 - EMETTEUR : FR00MON000002 MDT - MOTIF : PRLV FITNESS PARK EXEMPLE - FIT-00-00000000-AAAAAAAA - REF : FIT-00-00000000-AAAAAAAA LIB', '-35', '', ''],
  ['26-10-2026', 'Impôts et Taxes', 'Taxe foncière', 'PRELEVEMENT DGFIP IMPOT 00001 DU 26/10/26 - EMETTEUR : FR00ZZZ000001 MDT - MOTIF : 000000000000TLR0000000000000 TLRSEPA DGFIP IMPOT TF - REF : 0000000000TLR000000000000000000 LIB', '-600', '', ''],
  ['26-10-2026', 'Revenus', 'Virement reçu', 'VIREMENT DE MME DUPONT ANNE - MOTIF : VIREMENT VERS COMPTE DE CHEQUES', '300', '', ''],
  ['26-10-2026', 'Vie Quotidienne', 'Alimentation, supermarché', 'PAIEMENT CB CARREFOUR DU 23/10/26 A TOULOUSE - CARTE*2222', '-23.40', '', ''],
  ['26-10-2026', 'Loisirs et Sorties', 'Restaurants, bars', 'PAIEMENT CB SUNDAY*CHEZ PAUL DU 24/10/26 A 1 RUE EXEMPLE - CARTE*1111', '-18.50', '', ''],
  ['22-10-2026', 'Vie Quotidienne', 'Alimentation, supermarché', 'PAIEMENT CB LECLERC (FRANCE) DU 21/10/26 - CARTE*2222', '-55', '', ''],
  ['22-10-2026', 'Abonnements et Telephonie', 'Téléphone', 'PRELEVEMENT SFR DU 22/10/26 - EMETTEUR : FR00ZZZ000003 MDT - MOTIF : SFR PRLVT SEPA A-000000AA 000000000000 - REF : 000000000000 A-000000AA LIB', '-15.99', '', ''],
  ['22-10-2026', 'Abonnements et Telephonie', 'Internet, TV', 'PAIEMENT CB HELP.HBOMAX.COM DU 22/10/26 A AMSTERDAM - CARTE*1111', '-9.99', '', ''],
  ['20-10-2026', 'Revenus', 'Remboursement', 'VIREMENT INSTANTANE RECU DE MLLE ANNE DUPONT  MOTIF: REMBOURSEMENT - REF : 000000000000000000000002', '120', '', ''],
];

export function hbText(rows = HB_ROWS, sep = '\t', decimalComma = false): string {
  const fix = (r: string[]) => (decimalComma ? r.map((c, i) => (i === 4 ? c.replace('.', ',') : c)) : r);
  return [
    ['Compte de chèques ****8888', 'Solde au 02/11/2026', decimalComma ? '1500,00' : '1500.00', 'EUR', '', '', ''].join(sep),
    ''.padEnd(6, sep),
    ['Date operation', 'Categorie operation', 'Sous Categorie operation', 'Libelle operation', 'Montant operation', 'Pointage operation', 'Commentaire operation'].join(sep),
    ...rows.map((r) => fix(r).join(sep)),
  ].join('\n');
}
