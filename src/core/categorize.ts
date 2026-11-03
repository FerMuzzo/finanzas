// Automatic categories, in order of priority:
// 1. a category you chose by hand is never changed
// 2. your own rules ("label contains URSSAF → Taxes")
// 3. merchant memory: once you categorize a merchant, its other operations follow
// 4. operation type (bank fees, cash withdrawals)
// 5. starter keywords for common French merchants
// 6. the bank's own category, when the export has one (Hello bank)
// 7. simple fallbacks (salary words, money received, payments abroad)

import { keyOf } from './merchant';
import type { CatSource, Category, Transaction, VaultData } from './model';
import { normalizeKey } from './text';

export interface Suggestion {
  categoryId: string | null;
  source: CatSource | null;
}

// Keywords are compared on whole words after removing accents, digits and punctuation.
// A trailing * means "starts with".
const STARTER: [string, string[]][] = [
  ['groceries', ['CARREFOUR', 'MONOPRIX', 'MONOP', 'FRANPRIX', 'INTERMARCHE', 'LECLERC', 'E LECLERC', 'AUCHAN', 'LIDL', 'ALDI', 'CASINO', 'SUPER U', 'HYPER U', 'U EXPRESS', 'BIOCOOP', 'NATURALIA', 'PICARD', 'GRAND FRAIS', 'CORA', 'NETTO', 'SPAR', 'LA VIE CLAIRE', 'LEADER PRICE', 'GEANT', 'MARCHE', 'BOULANGERIE', 'BOULANGER*', 'BOUCHERIE', 'PRIMEUR', 'FROMAGERIE', 'EPICERIE', 'SUPERMARCHE', 'SUPERMARKET', 'MERCADONA']],
  ['eating_out', ['RESTAURANT', 'RESTO', 'BRASSERIE', 'BISTRO*', 'CAFE', 'BAR', 'PUB', 'PIZZ*', 'SUSHI', 'BURGER*', 'MCDONALD*', 'MC DONALD*', 'KFC', 'STARBUCKS', 'DELIVEROO', 'UBER EATS', 'UBER EATS*', 'JUST EAT', 'BRIOCHE DOREE', 'CREPERIE', 'KEBAB', 'TACOS', 'TAPAS', 'TRATTORIA', 'BOUILLON', 'BRULERIE', 'COFFEE', 'BISTROT', 'CANTINE', 'CROUS']],
  ['transport', ['SNCF', 'SNCF CONNECT', 'TISSEO', 'RATP', 'TCL', 'UBER TRIP', 'UBER', 'BOLT', 'HEETCH', 'BLABLACAR', 'TOTALENERGIES', 'TOTAL', 'ESSO', 'SHELL', 'BP', 'AVIA', 'STATION', 'PEAGE', 'VINCI AUTOROUTES', 'APRR', 'SANEF', 'PARKING', 'INDIGO', 'LIME', 'DOTT', 'TIER', 'VELO*', 'TRAINLINE', 'OUIGO', 'FLIXBUS', 'TAXI', 'G7']],
  ['travel', ['HOTEL', 'AIRBNB', 'BOOKING', 'EXPEDIA', 'AIR FRANCE', 'EASYJET', 'RYANAIR', 'VUELING', 'TRANSAVIA', 'VOLOTEA', 'IBERIA', 'LATAM', 'AEROPUERTO', 'AIRPORT', 'AEROPORT', 'DUTY FREE', 'HOSTEL', 'CAMPING']],
  ['subscriptions', ['NETFLIX', 'SPOTIFY', 'DEEZER', 'DISNEY*', 'HBOMAX', 'HBO', 'PRIME VIDEO', 'AMAZON PRIME', 'AMAZON PRIME*', 'APPLE COM BILL', 'ICLOUD', 'CANAL', 'YOUTUBE', 'CHATGPT', 'OPENAI', 'ANTHROPIC', 'CLAUDE AI', 'PATREON', 'AUDIBLE', 'DROPBOX', 'PROTON', 'GOOGLE STORAGE', 'GOOGLE ONE', 'MOLOTOV', 'CRUNCHYROLL', 'PARAMOUNT']],
  ['utilities', ['EDF', 'ENGIE', 'VEOLIA', 'SUEZ', 'EAU', 'FREE MOBILE', 'FREE TELECOM', 'SFR', 'RED BY SFR', 'ORANGE', 'SOSH', 'BOUYGUES', 'B YOU', 'BOX INTERNET', 'ENERCOOP', 'EKWATEUR', 'MINT ENERGIE', 'OHM ENERGIE', 'GAZ']],
  ['housing', ['LOYER', 'FONCIA', 'NEXITY', 'CITYA', 'SYNDIC', 'SCI*', 'AGENCE IMMOBILIERE', 'IKEA FAMILY']],
  ['insurance', ['ASSURANCE*', 'MAIF', 'MACIF', 'MAAF', 'MATMUT', 'AXA', 'ALLIANZ', 'GROUPAMA', 'MMA', 'GMF', 'MUTUELLE', 'HARMONIE', 'MGEN', 'ALAN', 'LUKO', 'HISCOX', 'APRIL']],
  ['health', ['PHARMACIE', 'PHARMA*', 'MEDECIN', 'DOCTEUR', 'DENTISTE', 'DENTAIRE', 'CABINET MEDICAL', 'LABORATOIRE', 'LABO', 'HOPITAL', 'CLINIQUE', 'KINE*', 'OSTEO*', 'OPTIC*', 'OPTICIEN', 'DOCTOLIB', 'RADIOLOGIE', 'ORTHOPHON*', 'PSY*']],
  ['personal_care', ['COIFF*', 'SALON', 'BARBER*', 'BARBIER', 'SEPHORA', 'NOCIBE', 'MARIONNAUD', 'YVES ROCHER', 'ESTHETIQUE', 'SPA', 'ONGLERIE']],
  ['shopping', ['AMAZON', 'AMAZON PAYMENTS', 'AMZN*', 'FNAC', 'DARTY', 'DECATHLON', 'IKEA', 'LEROY MERLIN', 'CASTORAMA', 'BRICO*', 'ZARA', 'H M', 'UNIQLO', 'KIABI', 'PRIMARK', 'ACTION', 'GIFI', 'BOULANGER', 'CDISCOUNT', 'VINTED', 'LEBONCOIN', 'ALIEXPRESS', 'SHEIN', 'TEMU', 'ZALANDO', 'NATURE ET DECOUVERTES', 'CULTURA', 'APPLE STORE', 'MANGO', 'CELIO', 'JULES', 'GALERIES LAFAYETTE', 'PRINTEMPS', 'MAISONS DU MONDE', 'HEMA', 'FLYING TIGER']],
  ['leisure', ['CINEMA', 'PATHE', 'GAUMONT', 'CGR', 'UTOPIA', 'MEGA CGR', 'MUSEE', 'MUSEUM', 'THEATRE', 'CONCERT', 'TICKETMASTER', 'FNAC SPECTACLES', 'BILLETREDUC', 'FITNESS', 'FITNESS PARK', 'SALLE DE SPORT', 'BASIC FIT', 'KEEP COOL', 'ON AIR', 'NEONESS', 'PISCINE', 'ESCALADE', 'CLIMB*', 'LIBRAIRIE', 'GIBERT', 'STEAM', 'PLAYSTATION', 'NINTENDO', 'XBOX', 'BOWLING', 'ZOO', 'SPORT']],
  ['taxes', ['DGFIP', 'IMPOT', 'IMPOTS', 'TRESOR PUBLIC', 'URSSAF', 'TAXE', 'ANTAI', 'AMENDE']],
  ['education', ['FORMATION', 'UNIVERSITE', 'ECOLE', 'UDEMY', 'COURSERA', 'INSCRIPTION']],
  ['gifts', ['DONATION', 'CROIX ROUGE', 'MSF', 'UNICEF', 'LEETCHI', 'HELLOASSO', 'CAGNOTTE', 'FLEURISTE']],
];

const INCOME_STARTER: [string, string[]][] = [
  ['salary', ['PAYE', 'PAIE', 'SALAIRE', 'SALARY', 'TRAITEMENT']],
  ['refunds', ['REMBOURSEMENT', 'REMBT', 'REMB', 'CPAM', 'AMELI', 'AVOIR', 'REFUND']],
];

// Hello bank style categories ("Vie Quotidienne / Alimentation, supermarché") mapped to ours
const BANK_MAP: [RegExp, string][] = [
  [/alimentation|supermarche|courses/, 'groceries'],
  [/restaurant|bars?\b|fast food|cafe/, 'eating_out'],
  [/telephon|mobile|electricite|gaz|\beau\b|energie/, 'utilities'],
  [/internet|tv|streaming|abonnement|multimedia/, 'subscriptions'],
  [/impot|taxe/, 'taxes'],
  [/loyer|logement|charges|habitation/, 'housing'],
  [/assurance|mutuelle|prevoyance/, 'insurance'],
  [/sante|pharmacie|medecin|soins|optique|dentist/, 'health'],
  [/carburant|transport|parking|peage|train|taxi|vehicule|auto|velo/, 'transport'],
  [/voyage|hotel|vacances|avion|hebergement/, 'travel'],
  [/coiffeur|esthetique|beaute/, 'personal_care'],
  [/vetement|shopping|achat|high.?tech|electromenager|bricolage|equipement|maison|jardin/, 'shopping'],
  [/sport|loisir|sortie|cinema|culture|spectacle|jeux|livre|musique/, 'leisure'],
  [/cadeau|\bdon|association|caritati/, 'gifts'],
  [/frais bancaire|banque|agios|commission/, 'bank_fees'],
  [/retrait|especes/, 'cash'],
  [/epargne|placement|investissement/, 'savings'],
  [/formation|education|scolarite|etude/, 'education'],
  [/salaire|paie|traitement/, 'salary'],
  [/remboursement/, 'refunds'],
  [/virement recu|revenus/, 'other_income'],
];

interface Keyword {
  words: string;
  prefix: boolean;
}

function compile(list: [string, string[]][]): [string, Keyword[]][] {
  return list.map(([cat, kws]) => [
    cat,
    kws.map((k) => ({ words: keyOf(k.replace(/\*$/, '')), prefix: k.endsWith('*') })).filter((k) => k.words),
  ]);
}

const STARTER_C = compile(STARTER);
const INCOME_C = compile(INCOME_STARTER);

function hay(t: Transaction): string {
  return ' ' + keyOf(t.counterparty + ' ' + (t.motif ?? '') + ' ' + (t.detail || t.label)) + ' ';
}

function hit(h: string, k: Keyword): boolean {
  return k.prefix ? h.includes(' ' + k.words) : h.includes(' ' + k.words + ' ');
}

function kindOf(categories: Category[], id: string): Category['kind'] | undefined {
  return categories.find((c) => c.id === id)?.kind;
}

/** Category suggested for one operation, ignoring any category it already has. */
export function suggestCategory(t: Transaction, data: VaultData): Suggestion {
  const h = hay(t);
  const out = t.amount < 0;
  const fits = (id: string) => {
    const kind = kindOf(data.categories, id);
    if (!kind) return false;
    if (kind === 'expense') return out || t.opType === 'card_refund';
    if (kind === 'income') return !out;
    return true;
  };

  for (const r of data.rules) {
    const words = keyOf(r.pattern);
    if (words && h.includes(' ' + words) && fits(r.categoryId)) return { categoryId: r.categoryId, source: 'rule' };
  }

  const mem = data.merchantMemory[t.merchantKey];
  if (mem && fits(mem)) return { categoryId: mem, source: 'memory' };

  if (t.opType === 'card_fee' || t.opType === 'bank_fee') return { categoryId: 'bank_fees', source: 'auto' };
  if (t.opType === 'interest' && !out) return { categoryId: 'interest', source: 'auto' };
  if (t.opType === 'cash_withdrawal') {
    // With a Cash account, a withdrawal only moves money into it; the cash spending is recorded there
    const hasCash = data.accounts.some((a) => a.bank === 'cash');
    return { categoryId: hasCash ? 'own_transfer' : 'cash', source: 'auto' };
  }

  if (out || t.opType === 'card_refund') {
    for (const [cat, kws] of STARTER_C) {
      if (kws.some((k) => hit(h, k))) return { categoryId: cat, source: 'starter' };
    }
  } else {
    for (const [cat, kws] of INCOME_C) {
      if (kws.some((k) => hit(h, k))) return { categoryId: cat, source: 'starter' };
    }
  }

  if (t.bankCategory) {
    // the sub category is more precise, so it is tried first
    const parts = t.bankCategory.split(' › ').reverse().map((p) => normalizeKey(p));
    for (const b of parts) {
      for (const [re, cat] of BANK_MAP) {
        if (re.test(b) && fits(cat)) return { categoryId: cat, source: 'bank' };
      }
    }
  }

  if (out && t.opType === 'card' && t.foreign?.country && !t.online) return { categoryId: 'travel', source: 'auto' };
  if (!out && t.opType === 'transfer_in') return { categoryId: 'other_income', source: 'auto' };
  if (!out && t.opType === 'card_refund') return { categoryId: 'refunds', source: 'auto' };
  return { categoryId: null, source: null };
}

/** Recompute categories of every operation you have not categorized by hand. Returns how many changed. */
export function categorizeAll(data: VaultData, only?: (t: Transaction) => boolean): number {
  let changed = 0;
  for (const t of data.transactions) {
    if (t.catSource === 'user') continue;
    if (t.transferId) {
      if (t.categoryId !== 'own_transfer') {
        t.categoryId = 'own_transfer';
        t.catSource = 'auto';
        changed++;
      }
      continue;
    }
    if (only && !only(t)) continue;
    const s = suggestCategory(t, data);
    if (s.categoryId !== t.categoryId) {
      t.categoryId = s.categoryId;
      t.catSource = s.source ?? undefined;
      changed++;
    }
  }
  return changed;
}

const NO_MEMORY_KEYS = new Set(['RETRAIT DAB', 'CHEQUE', 'FROM UNKNOWN', 'TO UNKNOWN', 'FRAIS PAIEMENT HORS ZONE EURO', '']);

/**
 * You chose a category by hand. The choice is kept for this operation, remembered for the
 * merchant, and applied to the other operations of the same merchant that you did not set
 * by hand. Returns how many other operations changed.
 */
export function setCategoryByHand(data: VaultData, t: Transaction, categoryId: string | null): number {
  t.categoryId = categoryId;
  t.catSource = categoryId ? 'user' : undefined;
  if (!categoryId || NO_MEMORY_KEYS.has(t.merchantKey) || categoryId === 'own_transfer') return 0;
  data.merchantMemory[t.merchantKey] = categoryId;
  return categorizeAll(data, (x) => x.merchantKey === t.merchantKey && x.id !== t.id);
}

export function catSourceLabel(s: CatSource | undefined): string {
  switch (s) {
    case 'user': return 'chosen by you';
    case 'rule': return 'from your rule';
    case 'memory': return 'learned from your choices';
    case 'starter': return 'recognized merchant';
    case 'bank': return "from the bank's category";
    case 'auto': return 'automatic';
    default: return '';
  }
}
