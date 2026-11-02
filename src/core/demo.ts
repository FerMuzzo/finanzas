// Invented data for trying the app. It goes through the real Société Générale importer.

import { pad } from './dates';
import { commitImport, previewImport } from './importService';
import { emptyVault, type VaultData } from './model';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function fr(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return (neg ? '-' : '') + Math.floor(a / 100) + ',' + pad(a % 100);
}

export function buildDemoVault(today = new Date()): VaultData {
  const r = rng(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const between = (min: number, max: number) => Math.round((min + r() * (max - min)) * 100);
  const rows: string[][] = [];
  const add = (y: number, m: number, d: number, label: string, detail: string, cents: number) => {
    const day = Math.min(d, 28);
    rows.push([`${pad(day)}/${pad(m)}/${y}`, label, detail, fr(cents), 'EUR']);
  };
  const card = (y: number, m: number, d: number, merchant: string, cents: number, suffix = '') => {
    const ref = String(Math.floor(r() * 1e15)).padStart(15, '1');
    add(y, m, d + 1, `CARTE X4821 ${pad(Math.min(d, 28))}/${pad(m)}`, `CARTE X4821 ${pad(Math.min(d, 28))}/${pad(m)} ${merchant}${suffix} ${ref}IOPD`, -cents);
  };

  const months: { y: number; m: number }[] = [];
  for (let i = 6; i >= 1; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth() + 1 });
  }

  const savingsTransfers: { date: string; cents: number }[] = [];
  for (const { y, m } of months) {
    const ym = `${y}${pad(m)}`;
    add(y, m, 1, '000001 VIR PERM', `000001 VIR PERM POUR: SCI LES LILAS REF: 4471${ym} MOTIF: Loyer`, -95000);
    add(y, m, 3, 'PRELEVEMENT EUROPE', `PRELEVEMENT EUROPEEN 77${ym} POUR CPTE DE:FREE MOBILE ID: FR00ZZZ111111 MOTIF: Forfait ${ym}`, -1999);
    add(y, m, 5, 'PRELEVEMENT EUROPE', `PRELEVEMENT EUROPEEN 88${ym} POUR CPTE DE:EDF CLIENTS PARTICULIERS ID: FR00ZZZ222222 MOTIF: Echeance electricite`, -between(55, 92));
    add(y, m, 8, 'PRELEVEMENT EUROPE', `PRELEVEMENT EUROPEEN 99${ym} POUR CPTE DE:BOX INTERNET SA ID: FR00ZZZ333333 MOTIF: Abonnement`, -2999);
    add(y, m, 10, 'PRELEVEMENT EUROPE', `PRELEVEMENT EUROPEEN 66${ym} POUR CPTE DE:MUTUELLE EXEMPLE ID: FR00ZZZ444444 MOTIF: Cotisation`, -4250);
    card(y, m, 14, 'NETFLIX.COM', 1349, ' COMMERCE ELECTRONIQUE');
    card(y, m, 2, 'SALLE DE SPORT FORME', 3490);
    add(y, m, 26, 'VIR RECU 55' + ym, `VIR RECU 55${ym}S DE: EXEMPLE EMPLOYEUR SA MOTIF: PAYE ${ym}`, 285000 + between(0, 40));
    const st = 30000;
    add(y, m, 27, '000001 VIR INSTANT', `000001 VIR INSTANTANE EMIS LOGITEL POUR: M. ALEX DEMO DATE: 27/${pad(m)}/${y} 09:12`, -st);
    savingsTransfers.push({ date: `${y}-${pad(m)}-27`, cents: st });

    const nGroceries = 6 + Math.floor(r() * 4);
    for (let i = 0; i < nGroceries; i++) card(y, m, 1 + Math.floor(r() * 27), pick(['CARREFOUR CITY', 'MONOPRIX', 'BIOCOOP', 'LIDL', 'MARCHE VICTOR HUGO']), between(9, 88));
    const nOut = 3 + Math.floor(r() * 5);
    for (let i = 0; i < nOut; i++) card(y, m, 1 + Math.floor(r() * 27), pick(['LE PETIT BISTROT', 'THE RED FOX', 'SUSHI KAN', 'CAFE DES ARTS', 'PIZZERIA NAPOLI']), between(6, 48));
    const nTransport = 2 + Math.floor(r() * 4);
    for (let i = 0; i < nTransport; i++) {
      const t = pick(['SNCF CONNECT', 'UBER *TRIP HELP.UBER.COM', 'TISSEO AGENCE']);
      card(y, m, 1 + Math.floor(r() * 27), t, between(4, t.startsWith('SNCF') ? 75 : 25), t === 'TISSEO AGENCE' ? '' : ' COMMERCE ELECTRONIQUE');
    }
    if (r() < 0.8) card(y, m, 1 + Math.floor(r() * 27), pick(['FNAC', 'DECATHLON', 'AMAZON PAYMENTS']), between(15, 120));
    if (r() < 0.6) card(y, m, 1 + Math.floor(r() * 27), 'PHARMACIE DU CENTRE', between(6, 32));
    if (r() < 0.5) card(y, m, 1 + Math.floor(r() * 27), 'CINEMA UTOPIA', 750);
    add(y, m, 12, `CARTE X4821 RETRAIT`, `CARTE X4821 RETRAIT DAB ${pad(11)}/${pad(m)} TOULOUSE CAPITOLE 123456789012345`, -pick([4000, 6000]));
  }

  // One trip abroad, with the foreign card fee
  const trip = months[3];
  card(trip.y, trip.m, 18, 'HOTEL SOL Y MAR 186,40 EUR ESPAGNE', 18640);
  card(trip.y, trip.m, 19, 'TAPAS LA ESQUINA 42,00 EUR ESPAGNE', 4200);
  card(trip.y, trip.m, 20, 'DUTY FREE SHOP 64,90 USD ETATS-UNIS D 1 EUR=1,0921 USD', 5943);
  add(trip.y, trip.m, 21, 'FRAIS PAIEMENT HOR', `FRAIS PAIEMENT HORS ZONE EURO CARTE X4821 20/${pad(trip.m)} 64,90 USD ETATS-UNIS D`, -162);

  rows.sort((a, b) => b[0].split('/').reverse().join('').localeCompare(a[0].split('/').reverse().join('')));
  const first = months[0];
  const last = months[months.length - 1];
  const text = [
    `="0000123400004821";01/${pad(first.m)}/${first.y};28/${pad(last.m)}/${last.y};${rows.length};28/${pad(last.m)}/${last.y};2418,37 EUR`,
    '',
    "Date de l'opération;Libellé;Détail de l'écriture;Montant de l'opération;Devise;",
    ...rows.map((row) => row.join(';') + ';'),
  ].join('\n');

  const v = emptyVault();
  v.settings.holderNames = ['Alex Demo'];
  const prev = previewImport(new TextEncoder().encode(text), 'demo-societe-generale.csv', v);
  commitImport(prev, v, 'Société Générale ••4821');

  // A savings account at Hello bank receiving the monthly transfers, through the Hello bank importer
  let bal = 420000;
  const hbRows: string[] = [];
  for (const s of savingsTransfers) {
    bal += s.cents;
    const [y, m, d] = s.date.split('-');
    hbRows.unshift(`${pad(Number(d) + 1)}-${m}-${y};Revenus;Virement reçu;VIREMENT DE M. ALEX DEMO - MOTIF : EPARGNE;${fr(s.cents)};;`);
  }
  const lastHb = savingsTransfers[savingsTransfers.length - 1].date.split('-');
  const hbText = [
    `Livret ****9302;Solde au ${pad(Number(lastHb[2]) + 1)}/${lastHb[1]}/${lastHb[0]};${fr(bal)};EUR;;;`,
    ';;;;;;',
    'Date operation;Categorie operation;Sous Categorie operation;Libelle operation;Montant operation;Pointage operation;Commentaire operation',
    ...hbRows,
  ].join('\n');
  const hbPrev = previewImport(new TextEncoder().encode(hbText), 'demo-hello-bank.csv', v);
  commitImport(hbPrev, v, 'Hello bank savings');
  const hb = v.accounts.find((a) => a.bank === 'hellobank');
  if (hb) hb.type = 'savings';
  return v;
}
