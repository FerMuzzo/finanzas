// Second invented Société Générale file: overlaps the first, contains a payment that was
// added by hand in the app, and one line that only differs by its reference number.
import { writeFileSync } from 'node:fs';
const rows = [
  ['02/11/2026','CARTE X1234 31/10','CARTE X1234 31/10 PHARMACIE DU CENTRE 900000000000010IOPD','-12,30','EUR'],
  ['30/10/2026','000001 VIR PERM','000001 VIR PERM POUR: MME DUPONT A ET MR MARTIN J REF: 900000000001 MOTIF: Loyer','-845,00','EUR'],
  ['30/10/2026','CARTE X1234 29/10','CARTE X1234 29/10 ASSO EXEMPLE COMMERCE ELECTRONIQUE 900000000000001IOPD','-48,00','EUR'],
  ['29/10/2026','CARTE X1234 27/10','CARTE X1234 27/10 AIRPORT SHOP EXEMPLE 20,00 USD CANADA 1 EUR=1,1500 USD 900000000000999IOPD','-17,39','EUR'],
];
const text = [`="0000123400009999";29/10/2026;02/11/2026;${rows.length};02/11/2026;920,30 EUR`, '', "Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise;", ...rows.map(r => r.join(';') + ';')].join('\r\n');
writeFileSync(process.argv[2], Buffer.from(text, 'latin1'));
