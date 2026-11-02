// Writes an invented Hello bank file for the browser tests
import { writeFileSync } from 'node:fs';
const rows = [
  ['02-11-2026','Revenus','Virement reçu','VIREMENT DE M. JEAN MARTIN - MOTIF : LOYER','845,00'],
  ['28-10-2026','Abonnements et Telephonie','Internet, TV','PAIEMENT CB NETFLIX DU 28/10/26 A AMSTERDAM - CARTE*1111','-10,99'],
  ['27-10-2026','Loisirs et Sorties','Restaurants, bars','PAIEMENT CB LE PETIT ZINC DU 26/10/26 A TOULOUSE - CARTE*2222','-42,00'],
  ['26-10-2026','Vie Quotidienne','Alimentation, supermarché','PAIEMENT CB CARREFOUR DU 23/10/26 A TOULOUSE - CARTE*2222','-23,40'],
  ['22-10-2026','Abonnements et Telephonie','Téléphone','PRELEVEMENT SFR DU 22/10/26 - EMETTEUR : FR00ZZZ000003 MDT - MOTIF : SFR PRLVT - REF : 0000 LIB','-15,99'],
];
const text = ['Compte de chèques ****8888;Solde au 02/11/2026;1500,00;EUR;;;', ';;;;;;', 'Date operation;Categorie operation;Sous Categorie operation;Libelle operation;Montant operation;Pointage operation;Commentaire operation', ...rows.map(r => r.join(';') + ';;')].join('\r\n');
writeFileSync(process.argv[2], Buffer.from(text, 'latin1'));
